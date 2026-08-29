import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PaymentProvider, PaymentStatus } from '@app/common';
import { createHash, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { ClickRequest, ClickResponse } from './click.types';
import { Payment } from './entities/payment.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentService } from './payment.service';

const clickErrors = {
  success: [0, 'Success'],
  sign: [-1, 'SIGN CHECK FAILED!'],
  amount: [-2, 'Incorrect parameter amount'],
  action: [-3, 'Action not found'],
  alreadyPaid: [-4, 'Already paid'],
  payment: [-5, 'Payment not found'],
  transaction: [-6, 'Transaction not found'],
  update: [-7, 'Failed to update payment'],
  cancelled: [-9, 'Transaction cancelled'],
} as const;

@Injectable()
export class ClickService {
  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(PaymentTransaction)
    private readonly transactions: Repository<PaymentTransaction>,
    private readonly paymentService: PaymentService,
  ) {}

  async prepare(request: ClickRequest): Promise<ClickResponse> {
    if (Number(request.action) !== 0)
      return this.fail(request, clickErrors.action);
    if (!(await this.hasValidSignature(request, false)))
      return this.fail(request, clickErrors.sign);

    const payment = await this.findPayment(request.merchant_trans_id);
    if (!payment) return this.fail(request, clickErrors.payment);
    if (Number(payment.amount) !== Number(request.amount))
      return this.fail(request, clickErrors.amount);
    if (payment.status === PaymentStatus.PAID)
      return this.fail(request, clickErrors.alreadyPaid);
    if (
      ![PaymentStatus.CREATED, PaymentStatus.PENDING].includes(payment.status)
    )
      return this.fail(request, clickErrors.cancelled);

    const providerTxnId = String(request.click_trans_id ?? '');
    const existing = await this.transactions.findOne({
      where: { providerTxnId },
    });
    if (existing) {
      if (
        existing.paymentId !== payment.id ||
        Number(existing.amount) !== Number(request.amount)
      )
        return this.fail(request, clickErrors.amount);
      return this.success(request, { merchant_prepare_id: existing.id });
    }

    const transaction = this.transactions.create({
      paymentId: payment.id,
      providerTxnId,
      state: 1,
      action: 'Prepare',
      amount: Number(request.amount),
      raw: { ...request },
      createTime: String(Date.now()),
      performTime: null,
      cancelTime: null,
      reason: null,
    });
    const saved = await this.transactions.save(transaction);
    payment.status = PaymentStatus.PENDING;
    payment.externalTxnId = providerTxnId;
    await this.payments.save(payment);
    return this.success(request, { merchant_prepare_id: saved.id });
  }

  async complete(request: ClickRequest): Promise<ClickResponse> {
    if (Number(request.action) !== 1)
      return this.fail(request, clickErrors.action);
    if (!(await this.hasValidSignature(request, true)))
      return this.fail(request, clickErrors.sign);

    const transaction = await this.transactions.findOne({
      where: { providerTxnId: String(request.click_trans_id ?? '') },
    });
    if (
      !transaction ||
      String(transaction.id) !== String(request.merchant_prepare_id ?? '')
    )
      return this.fail(request, clickErrors.transaction);

    const payment = await this.payments.findOne({
      where: { id: transaction.paymentId, provider: PaymentProvider.CLICK },
    });
    if (!payment) return this.fail(request, clickErrors.payment);
    if (
      String(payment.id) !== String(request.merchant_trans_id ?? '') &&
      String(payment.salesOrderId) !== String(request.merchant_trans_id ?? '')
    )
      return this.fail(request, clickErrors.payment);
    if (
      Number(payment.amount) !== Number(request.amount) ||
      Number(transaction.amount) !== Number(request.amount)
    )
      return this.fail(request, clickErrors.amount);

    if (transaction.state === 2 && payment.status === PaymentStatus.PAID)
      return this.success(request, { merchant_confirm_id: transaction.id });
    if (Number(request.error) < 0) {
      transaction.state = -1;
      transaction.action = 'CompleteCancelled';
      transaction.cancelTime = String(Date.now());
      transaction.reason = Number(request.error);
      transaction.raw = { ...request };
      await this.transactions.save(transaction);
      payment.status = PaymentStatus.CANCELLED;
      await this.payments.save(payment);
      return this.fail(request, clickErrors.cancelled);
    }
    if (transaction.state !== 1)
      return this.fail(request, clickErrors.transaction);

    const now = Date.now();
    transaction.state = 2;
    transaction.action = 'Complete';
    transaction.performTime = String(now);
    transaction.raw = { ...request };
    await this.transactions.save(transaction);
    payment.status = PaymentStatus.PAID;
    payment.paidAt = new Date(now);
    await this.payments.save(payment);
    return this.success(request, { merchant_confirm_id: transaction.id });
  }

  private async findPayment(reference?: string | number) {
    const value = String(reference ?? '');
    if (!value) return null;
    const byId = await this.payments.findOne({
      where: { id: value, provider: PaymentProvider.CLICK },
    });
    if (byId) return byId;
    return this.payments.findOne({
      where: { salesOrderId: value, provider: PaymentProvider.CLICK },
      order: { createdAt: 'DESC' },
    });
  }

  private async hasValidSignature(
    request: ClickRequest,
    complete: boolean,
  ): Promise<boolean> {
    const credentials = await this.paymentService.getProviderCredentials(
      PaymentProvider.CLICK,
    );
    if (!credentials?.secret || !credentials.merchantId) return false;
    if (String(request.service_id ?? '') !== credentials.merchantId)
      return false;
    const parts = [
      request.click_trans_id,
      request.service_id,
      credentials.secret,
      request.merchant_trans_id,
    ];
    if (complete) parts.push(request.merchant_prepare_id);
    parts.push(request.amount, request.action, request.sign_time);
    const expected = createHash('md5')
      .update(parts.map((part) => String(part ?? '')).join(''))
      .digest('hex');
    const actual = String(request.sign_string ?? '').toLowerCase();
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  private success(
    request: ClickRequest,
    extra: Pick<ClickResponse, 'merchant_prepare_id' | 'merchant_confirm_id'>,
  ): ClickResponse {
    return {
      click_trans_id: String(request.click_trans_id ?? ''),
      merchant_trans_id: String(request.merchant_trans_id ?? ''),
      ...extra,
      error: clickErrors.success[0],
      error_note: clickErrors.success[1],
    };
  }

  private fail(
    request: ClickRequest,
    error: readonly [number, string],
  ): ClickResponse {
    return {
      click_trans_id: String(request.click_trans_id ?? ''),
      merchant_trans_id: String(request.merchant_trans_id ?? ''),
      error: error[0],
      error_note: error[1],
    };
  }
}
