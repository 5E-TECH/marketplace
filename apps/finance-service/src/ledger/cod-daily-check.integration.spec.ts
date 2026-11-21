import { NotFoundException } from '@nestjs/common';
import { Client } from 'pg';
import { of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  COD_RECONCILIATION_MISMATCH_EVENT,
  FinanceRemittanceEvent,
} from '@app/common';
import { FINANCE_DB } from '../database';
import { CodDailyCheckService } from './cod-daily-check.service';
import { LedgerService } from './ledger.service';
import { orderEvent } from './order-events.samples';

const url = process.env.FINANCE_TEST_DATABASE_URL;
const describePostgres = url ? describe : describe.skip;
/** Session advisory lock: finance sxemasi testlari ketma-ket. */
const FINANCE_SCHEMA_TEST_LOCK = 2_304_001;

/** BE-21 TC4 haqiqiy Postgres da: kunlik COD sverkasi va farq xabari. */
describePostgres('BE-21 kunlik COD sverkasi (PostgreSQL)', () => {
  let lock: Client | undefined;
  let ds: DataSource;
  let ledger: LedgerService;
  const today = () =>
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });

  const remittance = (
    over: Partial<FinanceRemittanceEvent> = {},
  ): FinanceRemittanceEvent => ({
    schemaVersion: 2,
    eventId: 'rem-501',
    orderId: '501',
    shipmentId: '1251131',
    elchiStatus: 'paid',
    collectedFromCustomer: 291000,
    elchiFee: 40000,
    marketPaidAmount: 251000,
    occurredAt: '2026-12-21T10:00:00.000Z',
    ...over,
  });

  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_finance_test'))
      throw new Error(
        'FINANCE_TEST_DATABASE_URL nomi _finance_test bilan tugashi kerak',
      );
    lock = new Client({ connectionString: url });
    await lock.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [FINANCE_SCHEMA_TEST_LOCK]);
    await lock.query('DROP SCHEMA IF EXISTS finance CASCADE');
    await lock.query('CREATE SCHEMA finance');
    ds = await new DataSource({
      type: 'postgres',
      url,
      schema: 'finance',
      migrations: FINANCE_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    ledger = new LedgerService(ds);
    // bitta kunda: mos, mos emas (kam), qisman, kutilmoqda (buyurtma hodisasi yo‘q)
    await ledger.onOrderStatusChanged(orderEvent());
    await ledger.onRemittance(remittance());
    await ledger.onOrderStatusChanged(
      orderEvent({ eventId: 'e9', orderId: '509' }),
    );
    await ledger.onRemittance(
      remittance({
        eventId: 'rem-509',
        orderId: '509',
        marketPaidAmount: 240000,
      }),
    );
    await ledger.onOrderStatusChanged(
      orderEvent({ eventId: 'e11', orderId: '511' }),
    );
    await ledger.onRemittance(
      remittance({
        eventId: 'rem-511',
        orderId: '511',
        elchiStatus: 'partly_paid',
        marketPaidAmount: 100000,
      }),
    );
    await ledger.onRemittance(
      remittance({ eventId: 'rem-512', orderId: '512' }),
    );
  }, 300_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS finance CASCADE');
      await ds.destroy();
    }
    await lock?.end();
  });

  it('TC4: sverkada farq → moliya va nazoratchiga bir marta xabar; qayta hisoblashda takrorlanmaydi', async () => {
    const notifications = { emit: jest.fn(() => of(undefined)) };
    const service = new CodDailyCheckService(ds, notifications as never);
    const result = await service.run({ date: today() });
    expect(result).toMatchObject({
      date: today(),
      matched: 1,
      partial: 1,
      mismatch: 1,
      pending: 1,
    });
    expect(result.mismatches).toHaveLength(1);
    const [gap] = result.mismatches;
    expect(gap).toMatchObject({ orderId: '509', received: 240000 });
    expect(gap.diff).toBe(gap.received - gap.expected);
    expect(gap.diff).toBeLessThan(0);
    expect(result.alertedAt).not.toBeNull();
    expect(notifications.emit).toHaveBeenCalledTimes(1);
    expect(notifications.emit).toHaveBeenCalledWith(
      COD_RECONCILIATION_MISMATCH_EVENT,
      expect.objectContaining({
        date: today(),
        mismatchCount: 1,
        diffTotal: gap.diff,
        orders: [expect.objectContaining({ orderId: '509' })],
      }),
    );

    await service.run({ date: today() });
    expect(notifications.emit).toHaveBeenCalledTimes(1);
    await expect(service.get({ date: today() })).resolves.toMatchObject({
      mismatch: 1,
    });
  });

  it('hisob-kitobdan keyin ortiqcha o‘tkazma (kutilgan summa yozilmagan) ham farq sifatida chiqadi', async () => {
    await ledger.onOrderStatusChanged(
      orderEvent({ eventId: 'e21', orderId: '521' }),
    );
    await ledger.onRemittance(
      remittance({ eventId: 'rem-521', orderId: '521' }),
    );
    await ledger.onRemittance(
      remittance({
        eventId: 'rem-521-b',
        orderId: '521',
        marketPaidAmount: 351000,
      }),
    );
    const notifications = { emit: jest.fn(() => of(undefined)) };
    await ds.query('UPDATE finance.cod_daily_check SET alerted_at = NULL');
    const result = await new CodDailyCheckService(
      ds,
      notifications as never,
    ).run({ date: today() });
    const late = result.mismatches.find((m) => m.orderId === '521');
    expect(late).toMatchObject({ received: 351000 });
    expect(late!.expected).toBeGreaterThan(0);
    expect(late!.diff).toBe(late!.received - late!.expected);
    expect(notifications.emit).toHaveBeenCalledTimes(1);
  });

  it('xabar yuborilmasa — keyingi hisoblashda qayta urinadi; farqsiz kun — xabar yo‘q; sverkasiz kun — 404', async () => {
    await ds.query('UPDATE finance.cod_daily_check SET alerted_at = NULL');
    const failing = {
      emit: jest.fn(() => throwError(() => new Error('navbat yopiq'))),
    };
    await expect(
      new CodDailyCheckService(ds, failing as never).run({ date: today() }),
    ).resolves.toMatchObject({ alertedAt: null });
    const working = { emit: jest.fn(() => of(undefined)) };
    await expect(
      new CodDailyCheckService(ds, working as never).run({ date: today() }),
    ).resolves.toMatchObject({ alertedAt: expect.any(Date) });
    expect(working.emit).toHaveBeenCalledTimes(1);

    const quiet = { emit: jest.fn(() => of(undefined)) };
    await expect(
      new CodDailyCheckService(ds, quiet as never).run({ date: '2026-01-01' }),
    ).resolves.toMatchObject({ mismatch: 0, matched: 0 });
    expect(quiet.emit).not.toHaveBeenCalled();
    await expect(
      new CodDailyCheckService(ds, quiet as never).get({ date: '2025-01-01' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      new CodDailyCheckService(ds, quiet as never).get({ date: '2026-02-30' }),
    ).rejects.toThrow('YYYY-MM-DD');
  });
});
