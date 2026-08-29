import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PaymentProvider, PaymentStatus } from '@app/common';
import { timingSafeEqual } from 'crypto';
import { Between, Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentService } from './payment.service';
import {
  PaymeError,
  PaymeRequest,
  PaymeResponse,
  PaymeRpcPayload,
} from './payme.types';
import { PaymentEventsService } from './payment-events.service';

const errors = {
  auth: [
    -32504,
    'Недостаточно привилегий',
    'Ruxsat yetarli emas',
    'Insufficient privileges',
  ],
  method: [-32601, 'Метод не найден', 'Metod topilmadi', 'Method not found'],
  invalid: [
    -32600,
    'Неверный JSON-RPC запрос',
    'Noto‘g‘ri JSON-RPC so‘rovi',
    'Invalid JSON-RPC request',
  ],
  amount: [-31001, 'Неверная сумма', 'Noto‘g‘ri summa', 'Invalid amount'],
  account: [-31050, 'Заказ не найден', 'Buyurtma topilmadi', 'Order not found'],
  transaction: [
    -31003,
    'Транзакция не найдена',
    'Tranzaksiya topilmadi',
    'Transaction not found',
  ],
  perform: [
    -31008,
    'Невозможно выполнить операцию',
    'Operatsiyani bajarib bo‘lmaydi',
    'Unable to perform operation',
  ],
  cancel: [
    -31007,
    'Невозможно отменить транзакцию',
    'Tranzaksiyani bekor qilib bo‘lmaydi',
    'Unable to cancel transaction',
  ],
} as const;

@Injectable()
export class PaymeService {
  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(PaymentTransaction)
    private readonly transactions: Repository<PaymentTransaction>,
    private readonly paymentService: PaymentService,
    private readonly events: PaymentEventsService,
  ) {}

  async callback(payload: PaymeRpcPayload): Promise<PaymeResponse> {
    const request = payload?.body ?? {};
    if (!(await this.authorized(payload?.authorization)))
      return this.fail(request, errors.auth);
    if (!request.method || !request.params)
      return this.fail(request, errors.invalid);

    switch (request.method) {
      case 'CheckPerformTransaction':
        return this.checkPerform(request);
      case 'CreateTransaction':
        return this.createTransaction(request);
      case 'PerformTransaction':
        return this.performTransaction(request);
      case 'CancelTransaction':
        return this.cancelTransaction(request);
      case 'CheckTransaction':
        return this.checkTransaction(request);
      case 'GetStatement':
        return this.getStatement(request);
      default:
        return this.fail(request, errors.method);
    }
  }

  private async checkPerform(request: PaymeRequest): Promise<PaymeResponse> {
    const validation = await this.validatePayment(request);
    if ('error' in validation) return validation.error;
    return this.ok(request, { allow: true });
  }

  private async createTransaction(
    request: PaymeRequest,
  ): Promise<PaymeResponse> {
    const providerTxnId = String(request.params?.id ?? '');
    const existing = await this.transactions.findOne({
      where: { providerTxnId },
    });
    if (existing) {
      if (
        Math.round(Number(existing.amount) * 100) !==
        Number(request.params?.amount)
      )
        return this.fail(request, errors.amount, 'amount');
      return this.ok(request, this.transactionResult(existing));
    }

    const validation = await this.validatePayment(request);
    if ('error' in validation) return validation.error;
    const payment = validation.payment;
    const another = await this.transactions.findOne({
      where: { paymentId: payment.id },
    });
    if (another) return this.fail(request, errors.perform, 'account.order_id');

    const now = Date.now();
    const transaction = this.transactions.create({
      paymentId: payment.id,
      providerTxnId,
      state: 1,
      action: 'CreateTransaction',
      amount: payment.amount,
      raw: request.params ?? null,
      createTime: String(now),
      performTime: null,
      cancelTime: null,
      reason: null,
    });
    await this.transactions.save(transaction);
    payment.status = PaymentStatus.PENDING;
    payment.externalTxnId = providerTxnId;
    await this.payments.save(payment);
    return this.ok(request, this.transactionResult(transaction));
  }

  private async performTransaction(
    request: PaymeRequest,
  ): Promise<PaymeResponse> {
    const transaction = await this.findTransaction(request);
    if (!transaction) return this.fail(request, errors.transaction, 'id');
    if (transaction.state === 2) {
      const paidPayment = await this.payments.findOne({
        where: { id: transaction.paymentId },
      });
      if (paidPayment?.status === PaymentStatus.PAID) {
        await this.events.paid(paidPayment);
      }
      return this.ok(request, this.transactionResult(transaction));
    }
    if (transaction.state !== 1)
      return this.fail(request, errors.perform, 'id');

    const payment = await this.payments.findOne({
      where: { id: transaction.paymentId },
    });
    if (!payment) return this.fail(request, errors.account, 'id');
    const now = Date.now();
    transaction.state = 2;
    transaction.performTime = String(now);
    transaction.action = 'PerformTransaction';
    await this.transactions.save(transaction);
    payment.status = PaymentStatus.PAID;
    payment.paidAt = new Date(now);
    await this.payments.save(payment);
    await this.events.paid(payment);
    return this.ok(request, this.transactionResult(transaction));
  }

  private async cancelTransaction(
    request: PaymeRequest,
  ): Promise<PaymeResponse> {
    const transaction = await this.findTransaction(request);
    if (!transaction) return this.fail(request, errors.transaction, 'id');
    if (transaction.state !== null && transaction.state < 0)
      return this.ok(request, this.transactionResult(transaction));
    if (transaction.state !== 1 && transaction.state !== 2)
      return this.fail(request, errors.cancel, 'id');

    const payment = await this.payments.findOne({
      where: { id: transaction.paymentId },
    });
    const wasPerformed = transaction.state === 2;
    transaction.state = wasPerformed ? -2 : -1;
    transaction.cancelTime = String(Date.now());
    transaction.reason = Number(request.params?.reason ?? 0);
    transaction.action = 'CancelTransaction';
    await this.transactions.save(transaction);
    if (payment) {
      payment.status = PaymentStatus.CANCELLED;
      await this.payments.save(payment);
    }
    return this.ok(request, this.transactionResult(transaction));
  }

  private async checkTransaction(
    request: PaymeRequest,
  ): Promise<PaymeResponse> {
    const transaction = await this.findTransaction(request);
    if (!transaction) return this.fail(request, errors.transaction, 'id');
    return this.ok(request, this.transactionResult(transaction));
  }

  private async getStatement(request: PaymeRequest): Promise<PaymeResponse> {
    const from = Number(request.params?.from);
    const to = Number(request.params?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to)
      return this.fail(request, errors.invalid, 'from');
    const rows = await this.transactions.find({
      where: {
        createTime: Between(String(from), String(to)),
        payment: { provider: PaymentProvider.PAYME },
      },
      order: { createTime: 'ASC' },
    });
    return this.ok(request, {
      transactions: rows.map((row) => this.statementResult(row)),
    });
  }

  private async validatePayment(
    request: PaymeRequest,
  ): Promise<{ payment: Payment } | { error: PaymeResponse }> {
    const account = request.params?.account ?? {};
    const accountId = String(account.order_id ?? account.payment_id ?? '');
    let payment = accountId
      ? await this.payments.findOne({
          where: { id: accountId, provider: PaymentProvider.PAYME },
        })
      : null;
    if (!payment && accountId) {
      payment = await this.payments.findOne({
        where: {
          salesOrderId: accountId,
          provider: PaymentProvider.PAYME,
        },
        order: { createdAt: 'DESC' },
      });
    }
    if (!payment)
      return { error: this.fail(request, errors.account, 'account.order_id') };
    if (
      Math.round(Number(payment.amount) * 100) !==
      Number(request.params?.amount)
    )
      return { error: this.fail(request, errors.amount, 'amount') };
    if (
      ![PaymentStatus.CREATED, PaymentStatus.PENDING].includes(payment.status)
    )
      return { error: this.fail(request, errors.perform, 'account.order_id') };
    return { payment };
  }

  private findTransaction(request: PaymeRequest) {
    return this.transactions.findOne({
      where: { providerTxnId: String(request.params?.id ?? '') },
    });
  }

  private transactionResult(transaction: PaymentTransaction) {
    return {
      create_time: Number(transaction.createTime),
      perform_time: Number(transaction.performTime ?? 0),
      cancel_time: Number(transaction.cancelTime ?? 0),
      transaction: String(transaction.id),
      state: transaction.state,
      reason: transaction.reason,
    };
  }

  private statementResult(transaction: PaymentTransaction) {
    return {
      id: transaction.providerTxnId,
      time: Number(transaction.createTime),
      amount: Math.round(Number(transaction.amount) * 100),
      account: (transaction.raw?.account as Record<string, unknown>) ?? {},
      ...this.transactionResult(transaction),
    };
  }

  private async authorized(header?: string): Promise<boolean> {
    if (!header?.startsWith('Basic ')) return false;
    const secret = await this.paymentService.getProviderSecret(
      PaymentProvider.PAYME,
    );
    if (!secret) return false;
    let decoded = '';
    try {
      decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    } catch {
      return false;
    }
    const expected = `Paycom:${secret}`;
    const actualBuffer = Buffer.from(decoded);
    const expectedBuffer = Buffer.from(expected);
    return (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  private ok(request: PaymeRequest, result: unknown): PaymeResponse {
    return { jsonrpc: '2.0', id: request.id ?? null, result };
  }

  private fail(
    request: PaymeRequest,
    definition: readonly [number, string, string, string],
    data?: string,
  ): PaymeResponse {
    const error: PaymeError = {
      code: definition[0],
      message: { ru: definition[1], uz: definition[2], en: definition[3] },
    };
    if (data) error.data = data;
    return { jsonrpc: '2.0', id: request.id ?? null, error };
  }
}
