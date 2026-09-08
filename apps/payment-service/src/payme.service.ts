import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PaymentProvider, PaymentStatus } from '@app/common';
import { timingSafeEqual } from 'crypto';
import { Between, In, Not, LessThanOrEqual, Repository } from 'typeorm';
import { paymentAtomic, validReference } from './payment-atomic';
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

  async cancelPaidPayment(
    payment: Payment,
    reason = 5,
  ): Promise<PaymentTransaction> {
    const transaction = await this.transactions.findOne({
      where: { paymentId: payment.id },
      order: { createdAt: 'DESC' },
    });
    if (!transaction)
      throw new NotFoundException('Payme tranzaksiyasi topilmadi');
    if (transaction.state === -2) return transaction;
    if (transaction.state !== 2)
      throw new BadRequestException(
        'Faqat bajarilgan Payme tranzaksiyasini refund qilish mumkin',
      );

    transaction.state = -2;
    transaction.cancelTime = String(Date.now());
    transaction.reason = reason;
    transaction.action = 'CancelTransaction';
    return this.transactions.save(transaction);
  }

  async callback(payload: PaymeRpcPayload): Promise<PaymeResponse> {
    const request = payload?.body ?? {};
    if (!(await this.authorized(payload?.authorization)))
      return this.fail(request, errors.auth);
    if (!request.method || !request.params)
      return this.fail(request, errors.invalid);

    if (typeof request.params !== 'object' || Array.isArray(request.params))
      return this.fail(request, errors.invalid);
    return paymentAtomic(this.payments, (manager) => {
      const worker = new PaymeService(
        manager.getRepository(Payment),
        manager.getRepository(PaymentTransaction),
        this.paymentService,
        this.events,
      );
      return worker.dispatch(request);
    });
  }

  private async dispatch(request: PaymeRequest): Promise<PaymeResponse> {
    const params = request.params!;
    if (
      [
        'CreateTransaction',
        'PerformTransaction',
        'CancelTransaction',
        'CheckTransaction',
      ].includes(request.method!) &&
      (typeof params.id !== 'string' ||
        !params.id.length ||
        params.id.length > 255)
    )
      return this.fail(request, errors.invalid, 'id');
    if (
      request.method === 'CreateTransaction' &&
      (!Number.isSafeInteger(params.time) || params.time <= 0)
    )
      return this.fail(request, errors.invalid, 'time');
    if (
      request.method === 'CancelTransaction' &&
      ![1, 2, 3, 4, 5, 10].includes(params.reason)
    )
      return this.fail(request, errors.invalid, 'reason');
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
      where: { providerTxnId, provider: PaymentProvider.PAYME },
    });
    if (existing) {
      const account = request.params?.account;
      if (
        !account ||
        String(account.order_id ?? account.payment_id ?? '') !==
          String(
            existing.raw?.account &&
              ((existing.raw.account as Record<string, unknown>).order_id ??
                (existing.raw.account as Record<string, unknown>).payment_id),
          )
      )
        return this.fail(request, errors.account, 'account.order_id');
      if (
        !Number.isSafeInteger(request.params?.amount) ||
        request.params!.amount <= 0 ||
        Math.round(Number(existing.amount) * 100) !==
          Number(request.params?.amount)
      )
        return this.fail(request, errors.amount, 'amount');
      if ((await this.expire(existing)) || existing.state !== 1)
        return this.fail(request, errors.perform, 'id');
      return this.ok(request, this.transactionResult(existing));
    }

    const validation = await this.validatePayment(request);
    if ('error' in validation) return validation.error;
    const payment = validation.payment;
    const another = await this.transactions.findOne({
      where: { paymentId: payment.id, state: 1 },
    });
    if (another) return this.fail(request, errors.perform, 'account.order_id');

    const now = Date.now();
    if (now - Number(request.params!.time) >= 43_200_000)
      return this.fail(request, errors.perform, 'id');
    const transaction = this.transactions.create({
      paymentId: payment.id,
      providerTxnId,
      provider: PaymentProvider.PAYME,
      providerTime: String(request.params!.time),
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
    if (transaction.state === 2)
      return this.ok(request, this.transactionResult(transaction));
    if (await this.expire(transaction))
      return this.fail(request, errors.perform, 'id');
    if (transaction.state !== 1)
      return this.fail(request, errors.perform, 'id');

    const payment = await this.payments.findOne({
      where: { id: transaction.paymentId },
    });
    if (!payment) return this.fail(request, errors.account, 'id');
    if (
      payment.status !== PaymentStatus.PENDING ||
      payment.externalTxnId !== transaction.providerTxnId
    )
      return this.fail(request, errors.perform, 'id');
    const now = Date.now();
    transaction.state = 2;
    transaction.performTime = String(now);
    transaction.action = 'PerformTransaction';
    await this.transactions.save(transaction);
    payment.status = PaymentStatus.PAID;
    payment.paidAt = new Date(now);
    await this.payments.save(payment);
    await this.events.recordPaid(payment, this.payments.manager);
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
    if (
      !Number.isSafeInteger(request.params?.from) ||
      !Number.isSafeInteger(request.params?.to) ||
      from < 0 ||
      from > to
    )
      return this.fail(request, errors.invalid, 'from');
    const rows = await this.transactions.find({
      where: {
        providerTime: Between(String(from), String(to)),
        provider: PaymentProvider.PAYME,
      },
      order: { providerTime: 'ASC', id: 'ASC' },
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
    if (!validReference(accountId))
      return { error: this.fail(request, errors.account, 'account.order_id') };
    // account.order_id is our payment ID, also used by checkout links.
    const payment = await this.payments.findOne({
      where: { id: accountId, provider: PaymentProvider.PAYME },
    });
    if (!payment)
      return { error: this.fail(request, errors.account, 'account.order_id') };
    if (
      !Number.isSafeInteger(request.params?.amount) ||
      request.params!.amount <= 0 ||
      Math.round(Number(payment.amount) * 100) !==
        Number(request.params?.amount)
    )
      return { error: this.fail(request, errors.amount, 'amount') };
    if (
      ![PaymentStatus.CREATED, PaymentStatus.PENDING].includes(payment.status)
    )
      return { error: this.fail(request, errors.perform, 'account.order_id') };
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
      return { error: this.fail(request, errors.perform, 'account.order_id') };
    return { payment };
  }

  private findTransaction(request: PaymeRequest) {
    return this.transactions.findOne({
      where: {
        providerTxnId: String(request.params?.id ?? ''),
        provider: PaymentProvider.PAYME,
      },
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
      time: Number(transaction.providerTime),
      amount: Math.round(Number(transaction.amount) * 100),
      account: (transaction.raw?.account as Record<string, unknown>) ?? {},
      ...this.transactionResult(transaction),
    };
  }

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'payme-timeout',
    waitForCompletion: true,
  })
  async expirePending(): Promise<void> {
    await paymentAtomic(this.payments, async (manager) => {
      const worker = new PaymeService(
        manager.getRepository(Payment),
        manager.getRepository(PaymentTransaction),
        this.paymentService,
        this.events,
      );
      const rows = await worker.transactions.find({
        where: {
          provider: PaymentProvider.PAYME,
          state: 1,
          providerTime: LessThanOrEqual(String(Date.now() - 43_200_000)),
        },
        take: 100,
      });
      for (const row of rows) await worker.expire(row);
    });
  }

  private async expire(transaction: PaymentTransaction): Promise<boolean> {
    if (
      transaction.state !== 1 ||
      Date.now() - Number(transaction.providerTime) < 43_200_000
    )
      return false;
    transaction.state = -1;
    transaction.reason = 4;
    transaction.cancelTime = String(Date.now());
    transaction.action = 'Timeout';
    await this.transactions.save(transaction);
    const payment = await this.payments.findOne({
      where: { id: transaction.paymentId, provider: PaymentProvider.PAYME },
    });
    if (payment?.status === PaymentStatus.PENDING) {
      payment.status = PaymentStatus.CANCELLED;
      await this.payments.save(payment);
    }
    return true;
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
