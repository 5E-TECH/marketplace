import { PaymentProvider, PaymentStatus } from '@app/common';
import { PaymeService } from './payme.service';

describe('PaymeService (C3.2)', () => {
  const auth = `Basic ${Buffer.from('Paycom:sandbox-key').toString('base64')}`;

  function setup() {
    const payment = {
      id: '10',
      salesOrderId: '42',
      provider: PaymentProvider.PAYME,
      amount: 125000,
      status: PaymentStatus.CREATED,
      externalTxnId: null,
      paidAt: null,
      createdAt: new Date(),
    } as any;
    const transactionRows: any[] = [];
    const payments = {
      findOne: jest.fn(async ({ where }) => {
        if (
          (where.id === payment.id ||
            where.salesOrderId === payment.salesOrderId) &&
          (!where.provider || where.provider === payment.provider)
        )
          return payment;
        return null;
      }),
      save: jest.fn(async (value) => value),
    };
    const transactions = {
      findOne: jest.fn(async ({ where }) =>
        transactionRows.find(
          (row) =>
            (where.providerTxnId === undefined ||
              row.providerTxnId === where.providerTxnId) &&
            (where.paymentId === undefined ||
              row.paymentId === where.paymentId),
        ),
      ),
      find: jest.fn(async () => transactionRows),
      create: jest.fn((value) => ({ id: '77', ...value })),
      save: jest.fn(async (value) => {
        if (!transactionRows.includes(value)) transactionRows.push(value);
        return value;
      }),
    };
    const paymentService = {
      getProviderSecret: jest.fn().mockResolvedValue('sandbox-key'),
    };
    return {
      service: new PaymeService(
        payments as never,
        transactions as never,
        paymentService as never,
      ),
      payment,
      payments,
      transactions,
      transactionRows,
    };
  }

  const call = (
    service: PaymeService,
    method: string,
    params: Record<string, unknown>,
    authorization = auth,
  ) => service.callback({ authorization, body: { id: 1, method, params } });

  it('TC1: CheckPerform → Create → Perform paymentni PAID qiladi', async () => {
    const { service, payment } = setup();
    const base = { amount: 12500000, account: { order_id: '10' } };
    await expect(
      call(service, 'CheckPerformTransaction', base),
    ).resolves.toMatchObject({
      result: { allow: true },
    });
    await expect(
      call(service, 'CreateTransaction', {
        ...base,
        id: 'payme-1',
        time: Date.now(),
      }),
    ).resolves.toMatchObject({ result: { state: 1, transaction: '77' } });
    await expect(
      call(service, 'PerformTransaction', { id: 'payme-1' }),
    ).resolves.toMatchObject({ result: { state: 2 } });
    expect(payment.status).toBe(PaymentStatus.PAID);
    expect(payment.paidAt).toBeInstanceOf(Date);
  });

  it('TC2: noto‘g‘ri summa -31001 qaytaradi', async () => {
    const { service } = setup();
    await expect(
      call(service, 'CheckPerformTransaction', {
        amount: 1,
        account: { order_id: '10' },
      }),
    ).resolves.toMatchObject({ error: { code: -31001, data: 'amount' } });
  });

  it('TC3: noto‘g‘ri Basic authni rad etadi', async () => {
    const { service } = setup();
    await expect(
      call(service, 'CheckPerformTransaction', {}, 'Basic bad'),
    ).resolves.toMatchObject({ error: { code: -32504 } });
  });

  it('TC4: bajarilgan transaction cancel qilinsa state -2 va payment CANCELLED', async () => {
    const { service, payment } = setup();
    const base = { amount: 12500000, account: { order_id: '10' } };
    await call(service, 'CreateTransaction', { ...base, id: 'payme-1' });
    await call(service, 'PerformTransaction', { id: 'payme-1' });
    await expect(
      call(service, 'CancelTransaction', { id: 'payme-1', reason: 5 }),
    ).resolves.toMatchObject({ result: { state: -2, reason: 5 } });
    expect(payment.status).toBe(PaymentStatus.CANCELLED);
  });

  it('TC5: Perform ikki marta chaqirilsa idempotent', async () => {
    const { service, payments } = setup();
    const base = { amount: 12500000, account: { order_id: '10' } };
    await call(service, 'CreateTransaction', { ...base, id: 'payme-1' });
    await call(service, 'PerformTransaction', { id: 'payme-1' });
    const savesAfterFirstPerform = payments.save.mock.calls.length;
    await expect(
      call(service, 'PerformTransaction', { id: 'payme-1' }),
    ).resolves.toMatchObject({ result: { state: 2 } });
    expect(payments.save).toHaveBeenCalledTimes(savesAfterFirstPerform);
  });

  it('CheckTransaction mavjud transaction holatini qaytaradi', async () => {
    const { service } = setup();
    const base = { amount: 12500000, account: { order_id: '10' } };
    await call(service, 'CreateTransaction', { ...base, id: 'payme-1' });

    await expect(
      call(service, 'CheckTransaction', { id: 'payme-1' }),
    ).resolves.toMatchObject({
      result: { transaction: '77', state: 1 },
    });
  });

  it('GetStatement Payme transactionlarini berilgan vaqt oralig‘ida qaytaradi', async () => {
    const { service } = setup();
    const base = { amount: 12500000, account: { order_id: '10' } };
    const from = Date.now() - 1000;
    await call(service, 'CreateTransaction', { ...base, id: 'payme-1' });

    await expect(
      call(service, 'GetStatement', { from, to: Date.now() + 1000 }),
    ).resolves.toMatchObject({
      result: {
        transactions: [
          {
            id: 'payme-1',
            amount: 12500000,
            account: { order_id: '10' },
            state: 1,
          },
        ],
      },
    });
  });

  it('noma’lum JSON-RPC metodiga -32601 qaytaradi', async () => {
    const { service } = setup();

    await expect(call(service, 'UnknownMethod', {})).resolves.toMatchObject({
      error: { code: -32601 },
    });
  });
});
