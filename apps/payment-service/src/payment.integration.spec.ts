import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { of, throwError } from 'rxjs';
import {
  OutboxEvent,
  OutboxStatus,
  PaymentProvider,
  PaymentStatus,
} from '@app/common';
import { Payment } from './entities/payment.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { ProviderConfig } from './entities/provider-config.entity';
import { CreatePaymentTables1724241600000 } from './migrations/1724241600000-create-payment-tables';
import { AddPaymeTransactionState1724328000000 } from './migrations/1724328000000-add-payme-transaction-state';
import { HardenPaymentCallbacks1724414400000 } from './migrations/1724414400000-harden-payment-callbacks';
import { PaymentService } from './payment.service';
import { PaymeService } from './payme.service';
import { ClickService } from './click.service';
import { ClickRequest } from './click.types';
import { PaymentEventsService } from './payment-events.service';
import { PaymentOutboxRelayService } from './payment-outbox-relay.service';

const url = process.env.PAYMENT_TEST_DATABASE_URL;
const describePostgres = url ? describe : describe.skip;

describePostgres('C3.2/C3.3/C7.1 PostgreSQL integration', () => {
  let db: DataSource;
  let payments: PaymentService;
  let payme: PaymeService;
  let click: ClickService;
  let relay: PaymentOutboxRelayService;
  const checkout = { send: jest.fn(() => of({ status: 'CONFIRMED' })) };
  const secret = 'test-provider-secret';
  const auth = `Basic ${Buffer.from(`Paycom:${secret}`).toString('base64')}`;

  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_payment_test'))
      throw new Error('Use an isolated database ending in _payment_test');
    db = new DataSource({
      type: 'postgres',
      url,
      schema: 'payment',
      entities: [Payment, PaymentTransaction, ProviderConfig, OutboxEvent],
      migrations: [
        CreatePaymentTables1724241600000,
        AddPaymeTransactionState1724328000000,
        HardenPaymentCallbacks1724414400000,
      ],
      synchronize: false,
    });
    await db.initialize();
    await db.query('CREATE SCHEMA IF NOT EXISTS payment');
    await db.runMigrations();
    payments = new PaymentService(
      db.getRepository(Payment),
      db.getRepository(ProviderConfig),
      new ConfigService({
        INTEGRATION_CREDENTIAL_SECRET: 'isolated-test-encryption-key',
      }),
    );
    const events = new PaymentEventsService(checkout as never);
    payme = new PaymeService(
      db.getRepository(Payment),
      db.getRepository(PaymentTransaction),
      payments,
      events,
    );
    click = new ClickService(
      db.getRepository(Payment),
      db.getRepository(PaymentTransaction),
      payments,
      events,
    );
    relay = new PaymentOutboxRelayService(
      db.getRepository(OutboxEvent),
      events,
    );
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });
  beforeEach(async () => {
    await db.query(
      'TRUNCATE payment.outbox_event, payment.payment_transaction, payment.payment, payment.provider_config RESTART IDENTITY CASCADE',
    );
    checkout.send.mockReset().mockReturnValue(of({ status: 'CONFIRMED' }));
    for (const provider of [PaymentProvider.PAYME, PaymentProvider.CLICK])
      await payments.upsertProviderConfig(provider, {
        merchantId: '555',
        ...(provider === PaymentProvider.CLICK ? { serviceId: '123' } : {}),
        secret,
        isActive: true,
      });
  });
  const createPayment = (provider: PaymentProvider, salesOrderId = '42') =>
    payments.create({ provider, salesOrderId, amount: 125000 });
  const rpc = (
    method: string,
    params: Record<string, unknown>,
    authorization = auth,
  ) => payme.callback({ authorization, body: { id: 1, method, params } });
  const createPayme = (id = 'txn-1', paymentId = '1', time = Date.now()) =>
    rpc('CreateTransaction', {
      id,
      time,
      amount: 12500000,
      account: { order_id: paymentId },
    });
  const signed = (
    action: 0 | 1,
    extra: Partial<ClickRequest> = {},
  ): ClickRequest => {
    const r: ClickRequest = {
      click_trans_id: 'txn-1',
      service_id: '123',
      click_paydoc_id: '99',
      merchant_trans_id: '1',
      amount: '125000.00',
      action,
      error: 0,
      error_note: 'Success',
      sign_time: '2026-09-08 12:00:00',
      ...(action === 1 ? { merchant_prepare_id: '1' } : {}),
      ...extra,
    };
    const fields = [
      r.click_trans_id,
      r.service_id,
      secret,
      r.merchant_trans_id,
    ];
    if (action === 1) fields.push(r.merchant_prepare_id);
    fields.push(r.amount, r.action, r.sign_time);
    r.sign_string = createHash('md5').update(fields.join('')).digest('hex');
    return r;
  };

  it('parallel payment.create produces one payment', async () => {
    const rows = await Promise.all(
      Array.from({ length: 12 }, () => createPayment(PaymentProvider.PAYME)),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(await db.getRepository(Payment).count()).toBe(1);
  });

  it('Payme concurrent Create/Perform: one transaction, one durable paid event', async () => {
    await createPayment(PaymentProvider.PAYME);
    const created = await Promise.all(
      Array.from({ length: 12 }, () => createPayme()),
    );
    for (const r of created)
      expect(r).toMatchObject({ result: { state: 1, transaction: '1' } });
    const performed = await Promise.all(
      Array.from({ length: 12 }, () =>
        rpc('PerformTransaction', { id: 'txn-1' }),
      ),
    );
    for (const r of performed)
      expect(r).toMatchObject({ result: { state: 2 } });
    expect(await db.getRepository(PaymentTransaction).count()).toBe(1);
    expect(await db.getRepository(OutboxEvent).count()).toBe(1);
    expect(
      await db.getRepository(Payment).findOneByOrFail({ id: '1' }),
    ).toMatchObject({ status: PaymentStatus.PAID });
    expect(checkout.send).not.toHaveBeenCalled();
    await relay.relay();
    await relay.relay();
    expect(checkout.send).toHaveBeenCalledTimes(1);
    expect(
      await db.getRepository(OutboxEvent).findOneByOrFail({ id: '1' }),
    ).toMatchObject({ status: OutboxStatus.PROCESSED });
  });

  it('Click concurrent Prepare/Complete has one transaction and outbox event', async () => {
    await createPayment(PaymentProvider.CLICK);
    const prepared = await Promise.all(
      Array.from({ length: 12 }, () => click.prepare(signed(0))),
    );
    prepared.forEach((r) =>
      expect(r).toMatchObject({ error: 0, merchant_prepare_id: '1' }),
    );
    const completed = await Promise.all(
      Array.from({ length: 12 }, () => click.complete(signed(1))),
    );
    completed.forEach((r) =>
      expect(r).toMatchObject({ error: 0, merchant_confirm_id: '1' }),
    );
    expect(await db.getRepository(PaymentTransaction).count()).toBe(1);
    expect(await db.getRepository(OutboxEvent).count()).toBe(1);
  });

  it('different transaction IDs cannot reserve the same payment twice', async () => {
    await createPayment(PaymentProvider.CLICK);
    const results = await Promise.all(
      ['first', 'second'].map((click_trans_id) =>
        click.prepare(signed(0, { click_trans_id })),
      ),
    );
    expect(results.filter((r) => r.error === 0)).toHaveLength(1);
    expect(await db.getRepository(PaymentTransaction).count()).toBe(1);
  });

  it('Payme repeat Create checks account even when amount matches', async () => {
    await createPayment(PaymentProvider.PAYME);
    await createPayment(PaymentProvider.PAYME, '43');
    await createPayme();
    expect(await createPayme('txn-1', '2')).toMatchObject({
      error: { code: -31050 },
    });
    expect(await db.getRepository(PaymentTransaction).count()).toBe(1);
  });

  it('provider transaction IDs are isolated (including Payme Perform)', async () => {
    await createPayment(PaymentProvider.CLICK);
    await click.prepare(signed(0));
    expect(await rpc('PerformTransaction', { id: 'txn-1' })).toMatchObject({
      error: { code: -31003 },
    });
    await createPayment(PaymentProvider.PAYME, '43');
    expect(await createPayme('txn-1', '2')).toMatchObject({
      result: { state: 1 },
    });
    expect(await db.getRepository(PaymentTransaction).count()).toBe(2);
  });

  it('two providers cannot reserve payment for the same sales order', async () => {
    await createPayment(PaymentProvider.PAYME);
    await createPayment(PaymentProvider.CLICK);
    const [a, b] = await Promise.all([
      createPayme(),
      click.prepare(signed(0, { merchant_trans_id: '2' })),
    ]);
    expect(Number('result' in a) + Number(b.error === 0)).toBe(1);
  });

  it('write failure rolls back transaction, payment and outbox together', async () => {
    await createPayment(PaymentProvider.PAYME);
    await createPayme();
    await db.query(
      `ALTER TABLE payment.outbox_event ADD CONSTRAINT fail_test CHECK (event_type <> 'payment.paid')`,
    );
    try {
      await expect(
        rpc('PerformTransaction', { id: 'txn-1' }),
      ).rejects.toThrow();
      expect(
        await db.getRepository(PaymentTransaction).findOneByOrFail({ id: '1' }),
      ).toMatchObject({ state: 1 });
      expect(
        await db.getRepository(Payment).findOneByOrFail({ id: '1' }),
      ).toMatchObject({ status: PaymentStatus.PENDING, paidAt: null });
      expect(await db.getRepository(OutboxEvent).count()).toBe(0);
    } finally {
      await db.query(
        'ALTER TABLE payment.outbox_event DROP CONSTRAINT fail_test',
      );
    }
    expect(await rpc('PerformTransaction', { id: 'txn-1' })).toMatchObject({
      result: { state: 2 },
    });
  });

  it('checkout outage retains event and retries after recovery', async () => {
    await createPayment(PaymentProvider.CLICK);
    await click.prepare(signed(0));
    await click.complete(signed(1));
    checkout.send.mockReturnValueOnce(throwError(() => new Error('offline')));
    await relay.relay();
    expect(
      await db.getRepository(OutboxEvent).findOneByOrFail({ id: '1' }),
    ).toMatchObject({ status: OutboxStatus.PENDING });
    await relay.relay();
    expect(
      await db.getRepository(OutboxEvent).findOneByOrFail({ id: '1' }),
    ).toMatchObject({ status: OutboxStatus.PROCESSED });
  });

  it('GetStatement uses provider time inclusively and only Payme rows', async () => {
    await createPayment(PaymentProvider.PAYME);
    const time = Date.now() - 60000;
    await createPayme('txn-1', '1', time);
    expect(await rpc('GetStatement', { from: time, to: time })).toMatchObject({
      result: { transactions: [{ time, account: { order_id: '1' } }] },
    });
    expect(
      await rpc('GetStatement', { from: time + 1, to: time + 1000 }),
    ).toMatchObject({ result: { transactions: [] } });
  });

  it('12h timeout cancels pending payment and rejects Perform', async () => {
    await createPayment(PaymentProvider.PAYME);
    await createPayme();
    await db
      .getRepository(PaymentTransaction)
      .update('1', { providerTime: String(Date.now() - 43_200_001) });
    await payme.expirePending();
    expect(await rpc('PerformTransaction', { id: 'txn-1' })).toMatchObject({
      error: { code: -31008 },
    });
    expect(await rpc('CheckTransaction', { id: 'txn-1' })).toMatchObject({
      result: { state: -1, reason: 4 },
    });
    expect(await db.getRepository(OutboxEvent).count()).toBe(0);
  });

  it('cancel is terminal and repeat cancellation keeps original reason/time', async () => {
    await createPayment(PaymentProvider.PAYME);
    await createPayme();
    const result = await rpc('CancelTransaction', { id: 'txn-1', reason: 5 });
    expect(await rpc('CancelTransaction', { id: 'txn-1', reason: 3 })).toEqual(
      result,
    );
    expect(await rpc('PerformTransaction', { id: 'txn-1' })).toMatchObject({
      error: { code: -31008 },
    });
    expect(await createPayme()).toMatchObject({ error: { code: -31008 } });
  });

  it('Click cancelled transaction cannot become paid', async () => {
    await createPayment(PaymentProvider.CLICK);
    await click.prepare(signed(0));
    expect(await click.complete(signed(1, { error: -5017 }))).toMatchObject({
      error: -9,
    });
    expect(await click.complete(signed(1))).toMatchObject({ error: -9 });
    expect(await db.getRepository(OutboxEvent).count()).toBe(0);
  });

  it('malformed callbacks and invalid credentials make no writes', async () => {
    await createPayment(PaymentProvider.PAYME);
    expect(await rpc('CreateTransaction', {})).toMatchObject({
      error: { code: -32600 },
    });
    expect(
      await rpc('CheckPerformTransaction', {
        amount: 1,
        account: { order_id: 'abc' },
      }),
    ).toMatchObject({ error: { code: -31050 } });
    expect(
      await rpc('CheckPerformTransaction', {}, 'Basic invalid'),
    ).toMatchObject({ error: { code: -32504 } });
    expect(await click.prepare({})).toMatchObject({ error: -8 });
    expect(
      await click.prepare({ ...signed(0), sign_string: 'bad' }),
    ).toMatchObject({ error: -1 });
    expect(await db.getRepository(PaymentTransaction).count()).toBe(0);
  });

  it('C7.1 keys encrypted, service_id separate, status contains no secrets; disabled key rejected', async () => {
    expect(await payments.providerStatus(PaymentProvider.CLICK)).toMatchObject({
      configured: true,
      merchantId: '555',
      serviceId: '123',
      hasSecret: true,
    });
    expect(
      JSON.stringify(await payments.providerStatus(PaymentProvider.CLICK)),
    ).not.toContain(secret);
    const [stored] = await db.query(
      "SELECT secret_encrypted FROM payment.provider_config WHERE provider='CLICK'",
    );
    expect(stored.secret_encrypted).not.toContain(secret);
    expect(
      await payments.getProviderCredentials(PaymentProvider.CLICK),
    ).toMatchObject({ secret, serviceId: '123' });
    await payments.upsertProviderConfig(PaymentProvider.CLICK, {
      isActive: false,
    });
    expect(await click.prepare(signed(0))).toMatchObject({ error: -1 });
  });
  it('paid cancellation is terminal and suppresses a stale pending paid notification', async () => {
    await createPayment(PaymentProvider.PAYME);
    await createPayme();
    await rpc('PerformTransaction', { id: 'txn-1' });
    expect(
      await rpc('CancelTransaction', { id: 'txn-1', reason: 10 }),
    ).toMatchObject({ result: { state: -2, reason: 10 } });
    await relay.relay();
    expect(checkout.send).not.toHaveBeenCalled();
    expect(
      await db.getRepository(OutboxEvent).findOneByOrFail({ id: '1' }),
    ).toMatchObject({ status: OutboxStatus.FAILED });
  });

  it('Click write failure rolls back both status records', async () => {
    await createPayment(PaymentProvider.CLICK);
    await click.prepare(signed(0));
    await db.query(
      `ALTER TABLE payment.outbox_event ADD CONSTRAINT fail_click_test CHECK (event_type <> 'payment.paid')`,
    );
    try {
      await expect(click.complete(signed(1))).rejects.toThrow();
      expect(
        await db.getRepository(PaymentTransaction).findOneByOrFail({ id: '1' }),
      ).toMatchObject({ state: 1 });
      expect(
        await db.getRepository(Payment).findOneByOrFail({ id: '1' }),
      ).toMatchObject({ status: PaymentStatus.PENDING });
    } finally {
      await db.query(
        'ALTER TABLE payment.outbox_event DROP CONSTRAINT fail_click_test',
      );
    }
    expect(await click.complete(signed(1))).toMatchObject({ error: 0 });
  });

  it('migration upgrades legacy Click service ID, Payme time and missed PAID events', async () => {
    await createPayment(PaymentProvider.PAYME);
    await createPayme();
    await rpc('PerformTransaction', { id: 'txn-1' });
    await db.undoLastMigration();
    try {
      await db.query(
        "UPDATE payment.provider_config SET merchant_id='123' WHERE provider='CLICK'",
      );
    } finally {
      await db.runMigrations();
    }
    expect(await payments.providerStatus(PaymentProvider.CLICK)).toMatchObject({
      serviceId: '123',
    });
    const row = await db
      .getRepository(PaymentTransaction)
      .findOneByOrFail({ id: '1' });
    expect(row.provider).toBe(PaymentProvider.PAYME);
    expect(row.providerTime).toBe(String(row.raw!.time));
    expect(
      await db
        .getRepository(OutboxEvent)
        .countBy({ status: OutboxStatus.PENDING }),
    ).toBe(1);
    await relay.relay();
    expect(checkout.send).toHaveBeenCalledTimes(1);
  });
});
