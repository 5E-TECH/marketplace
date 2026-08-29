import { createHash } from 'crypto';
import { PaymentProvider, PaymentStatus } from '@app/common';
import { ClickService } from './click.service';
import { ClickRequest } from './click.types';

describe('ClickService (C3.3)', () => {
  const secret = 'click-sandbox-secret';
  const serviceId = '12345';

  function setup() {
    const payment = {
      id: '10',
      salesOrderId: '42',
      provider: PaymentProvider.CLICK,
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
          (row) => row.providerTxnId === where.providerTxnId,
        ),
      ),
      create: jest.fn((value) => ({ id: '77', ...value })),
      save: jest.fn(async (value) => {
        if (!transactionRows.includes(value)) transactionRows.push(value);
        return value;
      }),
    };
    const paymentService = {
      getProviderCredentials: jest.fn().mockResolvedValue({
        merchantId: serviceId,
        secret,
      }),
    };
    const events = { paid: jest.fn().mockResolvedValue(undefined) };
    return {
      service: new ClickService(
        payments as never,
        transactions as never,
        paymentService as never,
        events as never,
      ),
      payment,
      payments,
      transactionRows,
      events,
    };
  }

  function signed(
    action: 0 | 1,
    overrides: Partial<ClickRequest> = {},
  ): ClickRequest {
    const request: ClickRequest = {
      click_trans_id: 'click-1',
      service_id: serviceId,
      click_paydoc_id: 'paydoc-1',
      merchant_trans_id: '10',
      amount: '125000',
      action,
      error: 0,
      error_note: 'Success',
      sign_time: '2026-08-28 12:00:00',
      ...(action === 1 ? { merchant_prepare_id: '77' } : {}),
      ...overrides,
    };
    const values = [
      request.click_trans_id,
      request.service_id,
      secret,
      request.merchant_trans_id,
    ];
    if (action === 1) values.push(request.merchant_prepare_id);
    values.push(request.amount, request.action, request.sign_time);
    request.sign_string = createHash('md5')
      .update(values.map(String).join(''))
      .digest('hex');
    return request;
  }

  it('TC1: Prepare → Complete paymentni PAID qiladi', async () => {
    const { service, payment, events } = setup();

    await expect(service.prepare(signed(0))).resolves.toMatchObject({
      merchant_prepare_id: '77',
      error: 0,
    });
    await expect(service.complete(signed(1))).resolves.toMatchObject({
      merchant_confirm_id: '77',
      error: 0,
    });
    expect(payment.status).toBe(PaymentStatus.PAID);
    expect(payment.paidAt).toBeInstanceOf(Date);
    expect(events.paid).toHaveBeenCalledWith(payment);
  });

  it('TC2: noto‘g‘ri sign_string -1 bilan rad etiladi', async () => {
    const { service, events } = setup();

    await expect(
      service.prepare({ ...signed(0), sign_string: 'invalid' }),
    ).resolves.toMatchObject({ error: -1, error_note: 'SIGN CHECK FAILED!' });
    expect(events.paid).not.toHaveBeenCalled();
  });

  it('TC3: Complete summasi mos kelmasa -2 bilan rad etiladi', async () => {
    const { service, payment } = setup();
    await service.prepare(signed(0));

    await expect(
      service.complete(signed(1, { amount: '125001' })),
    ).resolves.toMatchObject({ error: -2 });
    expect(payment.status).toBe(PaymentStatus.PENDING);
  });

  it('Prepare va Complete takroriy chaqirilsa idempotent', async () => {
    const { service, payments, events } = setup();
    await service.prepare(signed(0));
    await expect(service.prepare(signed(0))).resolves.toMatchObject({
      merchant_prepare_id: '77',
      error: 0,
    });
    await service.complete(signed(1));
    const savesAfterComplete = payments.save.mock.calls.length;
    await expect(service.complete(signed(1))).resolves.toMatchObject({
      merchant_confirm_id: '77',
      error: 0,
    });
    expect(payments.save).toHaveBeenCalledTimes(savesAfterComplete);
    expect(events.paid).toHaveBeenCalledTimes(2);
  });

  it('Click yuborgan xato Complete transactionni bekor qiladi', async () => {
    const { service, payment, transactionRows, events } = setup();
    await service.prepare(signed(0));

    await expect(
      service.complete(signed(1, { error: -5017 })),
    ).resolves.toMatchObject({ error: -9 });
    expect(payment.status).toBe(PaymentStatus.CANCELLED);
    expect(transactionRows[0].state).toBe(-1);
    expect(events.paid).not.toHaveBeenCalled();
  });
});
