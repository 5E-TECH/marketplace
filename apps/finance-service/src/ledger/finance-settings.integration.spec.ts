import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { FinanceSettingKey } from '@app/common';
import { CreateFinanceTables1724673600000 } from '../migrations/1724673600000-create-finance-tables';
import { CreateCodReconciliation1724932800000 } from '../migrations/1724932800000-create-cod-reconciliation';
import { CreatePayoutSchedule1727568000000 } from '../migrations/1727568000000-create-payout-schedule';
import { CreateLedger1795478400000 } from '../migrations/1795478400000-create-ledger';
import { AddJournalLeadIndex1795564800000 } from '../migrations/1795564800000-add-journal-lead-index';
import { CreateWithdrawal1795651200000 } from '../migrations/1795651200000-create-withdrawal';
import { SettingComment1797552000000 } from '../migrations/1797552000000-setting-comment';
import { FinanceSettingsService } from './finance-settings.service';

const url = process.env.FINANCE_TEST_DATABASE_URL;
const describePostgres = url ? describe : describe.skip;
/** Session advisory lock: finance sxemasi testlari ketma-ket (BE-23 tekshiruvi). */
const FINANCE_SCHEMA_TEST_LOCK = 2_304_001;

/** BE-27 (ADM-2): moliya sozlamalari — haqiqiy PostgreSQL, `finance.setting` (BE-22, BE-23 seed lari bilan). */
describePostgres('BE-27 moliya sozlamalari (PostgreSQL)', () => {
  let schemaLock: Client;
  let ds: DataSource;
  let svc: FinanceSettingsService;
  const inDays = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString();

  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_finance_test'))
      throw new Error(
        'FINANCE_TEST_DATABASE_URL nomi _finance_test bilan tugashi kerak',
      );
    schemaLock = new Client({ connectionString: url });
    await schemaLock.connect();
    await schemaLock.query('SELECT pg_advisory_lock($1)', [
      FINANCE_SCHEMA_TEST_LOCK,
    ]);
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query('DROP SCHEMA IF EXISTS finance CASCADE');
    await admin.query('CREATE SCHEMA finance');
    await admin.end();
    ds = await new DataSource({
      type: 'postgres',
      url,
      schema: 'finance',
      migrations: [
        CreateFinanceTables1724673600000,
        CreateCodReconciliation1724932800000,
        CreatePayoutSchedule1727568000000,
        CreateLedger1795478400000,
        AddJournalLeadIndex1795564800000,
        CreateWithdrawal1795651200000,
        SettingComment1797552000000,
      ],
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    svc = new FinanceSettingsService(ds);
  }, 300_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS finance CASCADE');
      await ds.destroy();
    }
    if (schemaLock) {
      await schemaLock.query('SELECT pg_advisory_unlock($1)', [
        FINANCE_SCHEMA_TEST_LOCK,
      ]);
      await schemaLock.end();
    }
  });

  it('ro‘yxat: seed qiymatlari amalda (rad to‘lovi 20 000, minimal yechish 50 000)', async () => {
    const list = await svc.list();
    expect(list.map((s) => [s.key, s.current?.value])).toEqual([
      ['refusal_fee', 20000],
      ['withdrawal_min', 50000],
    ]);
    expect(list[0].scheduled).toEqual([]);
  });

  it('TC1: kelajak sanasi bilan — rejalashtirilgan, amaldagi o‘zgarmaydi; eski qiymat javobda (audit uchun)', async () => {
    const at = inDays(10);
    await expect(
      svc.set({
        key: FinanceSettingKey.REFUSAL_FEE,
        value: 25000,
        effectiveFrom: at,
        actorId: '7',
        comment: 'Moliya so‘rovi',
      }),
    ).resolves.toEqual({
      key: 'refusal_fee',
      before: 20000,
      after: 25000,
      effectiveFrom: at,
      laterScheduled: [],
    });
    const [refusal] = await svc.list();
    expect(refusal.current?.value).toBe(20000);
    expect(refusal.scheduled).toEqual([
      { value: 25000, effectiveFrom: at, changedBy: 'user:7' },
    ]);
    // hodisa vaqtidagi qiymat (BE-22 `refusalFee`): kuchga kirgandan keyingi hodisa — yangisi
    const [row] = (await ds.query(
      `SELECT value::int AS value FROM finance.setting
        WHERE key = 'refusal_fee' AND effective_from <= $1
        ORDER BY effective_from DESC LIMIT 1`,
      [inDays(11)],
    )) as Array<{ value: number }>;
    expect(row.value).toBe(25000);
  });

  it('hozirdan — darhol amalda; eski qiymat tarixda', async () => {
    const res = await svc.set({
      key: FinanceSettingKey.WITHDRAWAL_MIN,
      value: 100000,
      actorId: '7',
      comment: 'Moliya so‘rovi',
    });
    expect(res).toMatchObject({ before: 50000, after: 100000 });
    const [, withdrawal] = await svc.list();
    expect(withdrawal.current).toMatchObject({
      value: 100000,
      changedBy: 'user:7',
    });
    expect(withdrawal.history.map((h) => h.value)).toEqual([50000]);
  });

  it('rad: o‘tmish sanasi, noma’lum kalit, manfiy yoki kasr qiymat, 0 minimal yechish; bir vaqtga ikkinchi qiymat — 409', async () => {
    const base = { actorId: '7', comment: 'Moliya so‘rovi' };
    await expect(
      svc.set({
        ...base,
        key: 'refusal_fee',
        value: 1,
        effectiveFrom: inDays(-1),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.set({ ...base, key: 'return_window_days', value: 14 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.set({ ...base, key: 'refusal_fee', value: -1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.set({ ...base, key: 'refusal_fee', value: 1.5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.set({ ...base, key: 'withdrawal_min', value: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const at = inDays(20);
    await svc.set({
      ...base,
      key: 'refusal_fee',
      value: 30000,
      effectiveFrom: at,
    });
    await expect(
      svc.set({ ...base, key: 'refusal_fee', value: 31000, effectiveFrom: at }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejalashtirilgan qiymat: hozirgi o‘zgarish javobida ogohlantirish; bekor qilinadi; kuchga kirgani bekor qilinmaydi; izoh qatorda', async () => {
    const at = inDays(30);
    await svc.set({
      key: 'refusal_fee',
      value: 40000,
      effectiveFrom: at,
      actorId: '7',
      comment: 'Rejalashtirildi',
    });
    const now = await svc.set({
      key: 'refusal_fee',
      value: 21000,
      actorId: '7',
      comment: 'Hozirdan',
    });
    expect(
      now.laterScheduled.map((r) => [r.value, r.effectiveFrom]),
    ).toContainEqual([40000, at]);
    await expect(
      svc.cancelScheduled({ key: 'refusal_fee', effectiveFrom: at }),
    ).resolves.toMatchObject({ value: 40000, effectiveFrom: at });
    const [refusal] = await svc.list();
    expect(refusal.scheduled.map((r) => r.value)).not.toContain(40000);
    await expect(
      svc.cancelScheduled({
        key: 'refusal_fee',
        effectiveFrom: now.effectiveFrom,
      }),
    ).rejects.toThrow('allaqachon kuchga kirgan');
    const [row] = (await ds.query(
      `SELECT comment FROM finance.setting WHERE key = 'refusal_fee' AND effective_from = $1`,
      [now.effectiveFrom],
    )) as Array<{ comment: string }>;
    expect(row.comment).toBe('Hozirdan');
  });

  it('faqat sana — Toshkent kuni boshi; izohsiz — 400', async () => {
    const day = new Date(Date.now() + 40 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const res = await svc.set({
      key: 'withdrawal_min',
      value: 60000,
      effectiveFrom: day,
      actorId: '7',
      comment: 'Sana bilan',
    });
    expect(res.effectiveFrom).toBe(
      new Date(`${day}T00:00:00+05:00`).toISOString(),
    );
    await expect(
      svc.set({
        key: 'withdrawal_min',
        value: 60000,
        actorId: '7',
        comment: ' ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
