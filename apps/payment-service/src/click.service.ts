import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PaymentProvider, PaymentStatus } from '@app/common';
import { createHash, timingSafeEqual } from 'crypto';
import { In, Not, Repository } from 'typeorm';
import { paymentAtomic, validReference } from './payment-atomic';
import { ClickRequest, ClickResponse } from './click.types';
import { Payment } from './entities/payment.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentService } from './payment.service';
import { PaymentEventsService } from './payment-events.service';

const clickErrors = {
  success: [0, 'Success'],
  sign: [-1, 'SIGN CHECK FAILED!'],
  amount: [-2, 'Incorrect parameter amount'],
  action: [-3, 'Action not found'],
  alreadyPaid: [-4, 'Already paid'],
  payment: [-5, 'Payment not found'],
  transaction: [-6, 'Transaction not found'],
  update: [-7, 'Failed to update payment'],
  invalid: [-8, 'Error in request from click'],
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
    private readonly events: PaymentEventsService,
  ) {}

  async prepare(request: ClickRequest): Promise<ClickResponse> {
    if (!this.validRequest(request, false))
      return this.fail(request ?? {}, clickErrors.invalid);
    if (Number(request.action) !== 0)
      return this.fail(request, clickErrors.action);
    if (!(await this.hasValidSignature(request, false)))
      return this.fail(request, clickErrors.sign);
    return paymentAtomic(this.payments, (manager) => {
      const worker = new ClickService(
        manager.getRepository(Payment),
        manager.getRepository(PaymentTransaction),
        this.paymentService,
        this.events,
      );
      return worker.prepareLocked(request);
    });
  }

  private async prepareLocked(request: ClickRequest): Promise<ClickResponse> {
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

    const competing = await this.payments.findOne({
      where: {
        salesOrderId: payment.salesOrderId,
        id: Not(payment.id),
        status: In([
          PaymentStatus.PENDING,
          PaymentStatus.PAID,
          PaymentStatus.REFUNDED,
        ]),
      },
    });
    if (competing && competing.id !== payment.id)
      return this.fail(request, clickErrors.alreadyPaid);
    const providerTxnId = String(request.click_trans_id ?? '');
    const existing = await this.transactions.findOne({
      where: { providerTxnId, provider: PaymentProvider.CLICK },
    });
    if (existing) {
      if (
        existing.paymentId !== payment.id ||
        Number(existing.amount) !== Number(request.amount)
      )
        return this.fail(request, clickErrors.amount);
      if (existing.state !== 1)
        return this.fail(request, clickErrors.cancelled);
      return this.success(request, { merchant_prepare_id: existing.id });
    }

    const active = await this.transactions.findOne({
      where: { paymentId: payment.id, state: 1 },
    });
    if (active) return this.fail(request, clickErrors.update);
    if (Number(request.error) < 0)
      return this.fail(request, clickErrors.cancelled);
    const transaction = this.transactions.create({
      paymentId: payment.id,
      providerTxnId,
      provider: PaymentProvider.CLICK,
      providerTime: String(Date.now()),
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
    if (!this.validRequest(request, true))
      return this.fail(request ?? {}, clickErrors.invalid);
    if (Number(request.action) !== 1)
      return this.fail(request, clickErrors.action);
    if (!(await this.hasValidSignature(request, true)))
      return this.fail(request, clickErrors.sign);
    return paymentAtomic(this.payments, (manager) => {
      const worker = new ClickService(
        manager.getRepository(Payment),
        manager.getRepository(PaymentTransaction),
        this.paymentService,
        this.events,
      );
      return worker.completeLocked(request);
    });
  }

  private async completeLocked(request: ClickRequest): Promise<ClickResponse> {
    const transaction = await this.transactions.findOne({
      where: {
        providerTxnId: String(request.click_trans_id ?? ''),
        provider: PaymentProvider.CLICK,
      },
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
    if (String(payment.id) !== String(request.merchant_trans_id ?? ''))
      return this.fail(request, clickErrors.payment);
    if (
      Number(payment.amount) !== Number(request.amount) ||
      Number(transaction.amount) !== Number(request.amount)
    )
      return this.fail(request, clickErrors.amount);

    if (transaction.state === 2 && payment.status === PaymentStatus.PAID) {
      return this.success(request, { merchant_confirm_id: transaction.id });
    }
    if (transaction.state !== null && transaction.state < 0)
      return this.fail(request, clickErrors.cancelled);
    if (
      payment.status !== PaymentStatus.PENDING ||
      payment.externalTxnId !== transaction.providerTxnId
    )
      return this.fail(request, clickErrors.cancelled);
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
    await this.events.recordPaid(payment, this.payments.manager);
    return this.success(request, { merchant_confirm_id: transaction.id });
  }

  private async findPayment(reference?: string | number) {
    const value = String(reference ?? '');
    if (!value) return null;
    if (!validReference(value)) return null;
    return this.payments.findOne({
      where: { id: value, provider: PaymentProvider.CLICK },
    });
  }

  private validRequest(request: ClickRequest, complete: boolean): boolean {
    if (!request || typeof request !== 'object' || Array.isArray(request))
      return false;
    for (const field of [
      'click_trans_id',
      'service_id',
      'click_paydoc_id',
      'merchant_trans_id',
      'amount',
      'action',
      'error',
      'error_note',
      'sign_time',
      'sign_string',
    ] as const) {
      if (
        request[field] === undefined ||
        request[field] === null ||
        !['string', 'number'].includes(typeof request[field])
      )
        return false;
    }
    return (
      String(request.click_trans_id).length > 0 &&
      String(request.click_trans_id).length <= 255 &&
      validReference(String(request.merchant_trans_id)) &&
      /^\d+(\.\d{1,2})?$/.test(String(request.amount)) &&
      Number(request.amount) > 0 &&
      Number.isSafeInteger(Number(request.error)) &&
      Number(request.error) <= 0 &&
      (!complete || validReference(String(request.merchant_prepare_id)))
    );
  }

  private async hasValidSignature(
    request: ClickRequest,
    complete: boolean,
  ): Promise<boolean> {
    const credentials = await this.paymentService.getProviderCredentials(
      PaymentProvider.CLICK,
    );
    if (!credentials?.secret || !credentials.serviceId) return false;
    if (String(request.service_id ?? '') !== credentials.serviceId)
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
