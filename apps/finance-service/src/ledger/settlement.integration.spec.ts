import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { WholesalerSettlementStatus } from '@app/common';
import { CreateFinanceTables1724673600000 } from '../migrations/1724673600000-create-finance-tables';
import { CreateCodReconciliation1724932800000 } from '../migrations/1724932800000-create-cod-reconciliation';
import { CreatePayoutSchedule1727568000000 } from '../migrations/1727568000000-create-payout-schedule';
import { CreateLedger1795478400000 } from '../migrations/1795478400000-create-ledger';
import { AddJournalLeadIndex1795564800000 } from '../migrations/1795564800000-add-journal-lead-index';
import { CreateWithdrawal1795651200000 } from '../migrations/1795651200000-create-withdrawal';
import { CreateWholesalerSettlement1795737600000 } from '../migrations/1795737600000-create-wholesaler-settlement';
import { BalanceCheckService } from './balance-check.service';
import { LedgerService } from './ledger.service';
import { orderEvent } from './order-events.samples';
import { SettlementService, SKIPPED_NO_WINDOW } from './settlement.service';

const url = process.env.FINANCE_TEST_DATABASE_URL;
const describePostgres = url ? describe : describe.skip;
const FINANCE_SCHEMA_TEST_LOCK = 2_304_001;
let schemaLock: Client | undefined;

/**
 * BE-33 — optovik haftalik hisob-kitobi (PostgreSQL). Davr: dushanba 2027-01-04 … yakshanba 2027-01-10,
 * ishga tushish dushanba 2027-01-11 09:00 Toshkent (04:00 UTC); qaytarish muddati testda 10 kun (sozlama).
 */
describePostgres('BE-33 optovik hisob-kitobi (PostgreSQL)', () => {
  let ds: DataSource;
  let ledger: LedgerService;
  let svc: SettlementService;
  let check: BalanceCheckService;
  let seq = 0;
  const MONDAY = '2027-01-11T04:00:00.000Z';

  /** Yetkazilgan buyurtma (optovik bazaviy narxi 140 000) va, kerak bo‘lsa, Elchi o‘tkazmasi (AVAILABLE). */
  const deliver = async (wholesalerId: string, at: string, remit = true) => {
    const orderId = String(700 + ++seq);
    await ledger.onOrderStatusChanged(
      orderEvent({
        eventId: `d-${orderId}`,
        orderId,
        leadId: String(8000 + seq),
        affiliateId: '42',
        wholesalerId,
        occurredAt: at,
      }),
    );
    if (remit)
      await ledger.onRemittance({
        schemaVersion: 2,
        eventId: `rem-${orderId}`,
        orderId,
        shipmentId: `s-${orderId}`,
        elchiStatus: 'paid',
        collectedFromCustomer: 291000,
        elchiFee: 40000,
        marketPaidAmount: 251000,
        occurredAt: at,
      });
    return orderId;
  };
  const window = (days: number) =>
    ds.query(
      `INSERT INTO finance.setting (key, value, effective_from, changed_by) VALUES ('return_window_days', $1, '2026-01-01T00:00:00Z', 'test')`,
      [days],
    );
  const balance = async (type: string, owner = '') =>
    Number(
      (
        await ds.query(
          `SELECT available_balance::bigint::text AS v FROM finance.account WHERE type = $1 AND owner_id = $2`,
          [type, owner],
        )
      )[0]?.v ?? 0,
    );
  const expectBalanced = async () => {
    const r = await check.run();
    expect(r.details.unbalancedJournals).toEqual([]);
    expect(r.details.accounts).toEqual([]);
    expect(r.ok).toBe(true);
  };

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
        CreateWholesalerSettlement1795737600000,
      ],
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    // «Hozir» — test sanalari (2027-yil) kelajakda qolmasligi uchun
    jest
      .spyOn(SettlementService.prototype as never, 'nowMs' as never)
      .mockReturnValue(Date.parse('2027-03-01T00:00:00Z') as never);
    ledger = new LedgerService(ds);
    svc = new SettlementService(ds, ledger);
    check = new BalanceCheckService(ds);
  }, 300_000);

  beforeEach(async () => {
    await ds.query(`TRUNCATE finance.wholesaler_settlement_item, finance.wholesaler_settlement,
      finance.withdrawal_approval, finance.withdrawal_request, finance.affiliate_payout_profile,
      finance.ledger_entry, finance.journal, finance.remittance_item, finance.elchi_remittance,
      finance.balance_check, finance.processed_event, finance.event_failure`);
    await ds.query(`DELETE FROM finance.account WHERE owner_id <> ''`);
    await ds.query(
      `UPDATE finance.account SET hold_balance = 0, available_balance = 0`,
    );
    await ds.query(
      `DELETE FROM finance.setting WHERE key = 'return_window_days'`,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS finance CASCADE');
      await ds.destroy();
    }
    await schemaLock?.end();
  });

  it('qaytarish muddati (EQ-10) sozlanmagan — akt tuzilmaydi (manbasiz sukut yo‘q)', async () => {
    await deliver('501', '2026-12-28T10:00:00.000Z');
    expect(await svc.run({ asOf: MONDAY })).toEqual({
      periodEnd: '2027-01-10',
      skipped: SKIPPED_NO_WINDOW,
      settlements: 0,
      items: 0,
    });
    expect((await svc.list({ query: {} })).total).toBe(0);
  });

  it('TC1, TC2: dushanba — muddati o‘tgan va Elchi puli kelgan tovarlar optovik bo‘yicha aktga; qolganlari kirmaydi', async () => {
    await window(10);
    await deliver('501', '2026-12-28T10:00:00.000Z'); // 01-07 da muddat o‘tdi → kiradi
    await deliver('501', '2026-12-31T10:00:00.000Z'); // 01-10 da o‘tdi → kiradi
    await deliver('502', '2026-12-29T10:00:00.000Z'); // boshqa optovik
    await deliver('501', '2027-01-05T10:00:00.000Z'); // 01-15 — muddati o‘tmagan (TC2)
    await deliver('501', '2026-12-27T10:00:00.000Z', false); // Elchi puli kelmagan (HOLD)
    expect(await svc.run({ asOf: MONDAY })).toEqual({
      periodEnd: '2027-01-10',
      skipped: null,
      settlements: 2,
      items: 3,
    });
    const page = await svc.list({ query: { wholesalerId: '501' } });
    expect(page.items[0]).toMatchObject({
      wholesalerId: '501',
      periodStart: '2027-01-04',
      periodEnd: '2027-01-10',
      returnWindowDays: 10,
      status: WholesalerSettlementStatus.READY,
      totalAmount: 280000,
      itemsCount: 2,
    });
    // Takror ishga tushirish — ikki marta kirmaydi
    expect((await svc.run({ asOf: MONDAY })).items).toBe(0);
    // Keyingi dushanba — muddati endi o‘tgan tovar keyingi aktga
    const next = await svc.run({ asOf: '2027-01-18T04:00:00.000Z' });
    expect(next).toMatchObject({
      periodEnd: '2027-01-17',
      settlements: 1,
      items: 1,
    });
    // PDF va bank fayli
    const pdf = await svc.actPdf({ id: page.items[0].id });
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 4).toString()).toBe(
      '%PDF',
    );
    expect(pdf.fileName).toMatch(/^akt-sverka_AS-\d{6}_2027-01-10\.pdf$/);
    const bank = await svc.bankFile({ periodEnd: '2027-01-10' });
    const csv = Buffer.from(bank.base64, 'base64').toString('utf8');
    expect(csv.startsWith('﻿Hujjat raqami;Sana;')).toBe(true);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3); // sarlavha + 2 optovik
    expect(csv).toContain(';280000;');
  });

  it('xatoli buyurtma (ochiq event_failure) aktga kirmaydi; hodisa keyin muvaffaqiyatli ishlansa — kiradi', async () => {
    await window(10);
    const orderId = await deliver('501', '2026-12-28T10:00:00.000Z');
    await ds.query(
      `INSERT INTO finance.event_failure (consumer, event_id, reason, payload) VALUES ('order.returned', 'ev-x', 'qisman', $1)`,
      [JSON.stringify({ orderId })],
    );
    expect((await svc.run({ asOf: MONDAY })).items).toBe(0);
    await ds.query(
      `INSERT INTO finance.processed_event (consumer, event_id) VALUES ('order.returned', 'ev-x')`,
    );
    expect((await svc.run({ asOf: '2027-01-18T04:00:00.000Z' })).items).toBe(1);
  });

  it('«To‘landi» faqat bank faylidan keyin; aynan fayldagi summa ledgerga; takror — o‘sha natija; kechki tekshiruv farqsiz', async () => {
    await window(10);
    await deliver('501', '2026-12-28T10:00:00.000Z');
    await svc.run({ asOf: MONDAY });
    const [s] = (await svc.list({ query: {} })).items;
    await expect(svc.markPaid({ id: s.id, paidBy: '7' })).rejects.toMatchObject(
      {
        status: 409,
        response: { errorCode: 'INVALID_STATE' },
      },
    );
    await svc.bankFile({ periodEnd: '2027-01-10' });
    expect(await svc.get({ id: s.id })).toMatchObject({
      status: WholesalerSettlementStatus.EXPORTED,
      exportedTotal: 140000,
      debtDeducted: 0,
    });
    const paid = await svc.markPaid({ id: s.id, paidBy: '7' });
    expect(paid).toMatchObject({
      status: WholesalerSettlementStatus.PAID,
      paidBy: '7',
    });
    expect(await balance('WHOLESALER', '501')).toBe(0);
    expect(
      await ds.query(
        `SELECT e.line_kind AS "lineKind", a.type, e.amount::int AS amount, j.order_id AS "orderId"
           FROM finance.journal j JOIN finance.ledger_entry e ON e.journal_id = j.id
           JOIN finance.account a ON a.id = e.account_id WHERE j.kind = 'WHOLESALER_PAID' ORDER BY e.id`,
      ),
    ).toEqual([
      {
        lineKind: 'WHOLESALER_PAYOUT',
        type: 'WHOLESALER',
        amount: -140000,
        orderId: null,
      },
      {
        lineKind: 'WHOLESALER_PAYOUT',
        type: 'COD_CLEARING',
        amount: 140000,
        orderId: null,
      },
    ]);
    await svc.markPaid({ id: s.id, paidBy: '8' });
    expect(
      Number(
        (
          await ds.query(
            `SELECT count(*) AS n FROM finance.journal WHERE kind = 'WHOLESALER_PAID'`,
          )
        )[0].n,
      ),
    ).toBe(1);
    await expect(
      svc.bankFile({ periodEnd: '2027-01-10' }),
    ).rejects.toMatchObject({ status: 404 });
    await expectBalanced();
  });

  it('bank faylida summa muzlaydi: aktdan keyin qaytgan tovar chiqadi; keyin qaytsa — qarz, keyingi aktdan ushlanadi', async () => {
    await window(10);
    const a = await deliver('501', '2026-12-28T10:00:00.000Z');
    await deliver('501', '2026-12-29T10:00:00.000Z');
    await svc.run({ asOf: MONDAY });
    const [s] = (await svc.list({ query: {} })).items;
    expect(s.totalAmount).toBe(280000);
    const ret = (orderId: string, at: string) =>
      ledger.onOrderReturned({
        eventId: `ret-${orderId}`,
        orderId,
        returnRequestId: `RR-${orderId}`,
        items: [{ productId: '88', quantity: 1 }],
        occurredAt: at,
      });
    await ret(a, '2027-01-12T10:00:00.000Z'); // fayldan oldin
    const csv = Buffer.from(
      (await svc.bankFile({ periodEnd: '2027-01-10' })).base64,
      'base64',
    ).toString('utf8');
    expect(csv).toContain(';140000;');
    expect(await svc.get({ id: s.id })).toMatchObject({
      exportedTotal: 140000,
      itemsCount: 1,
    });
    // Fayl chiqqach yana qaytsa — «To‘landi» fayldagi 140 000 ni yozadi, optovikda qarz qoladi
    const b = (await svc.get({ id: s.id })).items[0].orderId;
    await ret(b, '2027-01-13T10:00:00.000Z');
    await svc.markPaid({ id: s.id, paidBy: '7' });
    expect(await balance('WHOLESALER', '501')).toBe(-140000);
    await expectBalanced();
    // Keyingi hafta: ikki yangi tovar (280 000) — qarz 140 000 ushlanadi, 140 000 o‘tkaziladi
    await deliver('501', '2027-01-04T10:00:00.000Z');
    await deliver('501', '2027-01-05T10:00:00.000Z');
    await svc.run({ asOf: '2027-01-18T04:00:00.000Z' });
    await svc.bankFile({ periodEnd: '2027-01-17' });
    const [next] = (await svc.list({ query: { periodEnd: '2027-01-17' } }))
      .items;
    expect(next).toMatchObject({
      status: WholesalerSettlementStatus.EXPORTED,
      totalAmount: 280000,
      debtDeducted: 140000,
      exportedTotal: 140000,
    });
    await svc.markPaid({ id: next.id, paidBy: '7' });
    expect(await balance('WHOLESALER', '501')).toBe(0);
    await expectBalanced();
  });

  it('qarz akt summasidan katta — NETTED (o‘tkazma yo‘q); hamma tovari qaytgan akt — VOID', async () => {
    await window(10);
    const a = await deliver('501', '2026-12-28T10:00:00.000Z');
    await svc.run({ asOf: MONDAY });
    await svc.bankFile({ periodEnd: '2027-01-10' });
    const [s] = (await svc.list({ query: {} })).items;
    await svc.markPaid({ id: s.id, paidBy: '7' });
    await ledger.onOrderReturned({
      eventId: 'ret-a',
      orderId: a,
      returnRequestId: 'RR-a',
      items: [{ productId: '88', quantity: 1 }],
      occurredAt: '2027-01-12T10:00:00.000Z',
    });
    await deliver('501', '2027-01-04T10:00:00.000Z');
    const v = await deliver('503', '2027-01-04T10:00:00.000Z');
    await svc.run({ asOf: '2027-01-18T04:00:00.000Z' });
    await ledger.onOrderReturned({
      eventId: 'ret-v',
      orderId: v,
      returnRequestId: 'RR-v',
      items: [{ productId: '88', quantity: 1 }],
      occurredAt: '2027-01-15T10:00:00.000Z',
    });
    await expect(
      svc.bankFile({ periodEnd: '2027-01-17' }),
    ).rejects.toMatchObject({ status: 404 });
    const byW = Object.fromEntries(
      (await svc.list({ query: { periodEnd: '2027-01-17' } })).items.map(
        (x) => [x.wholesalerId, x],
      ),
    );
    expect(byW['501']).toMatchObject({
      status: WholesalerSettlementStatus.NETTED,
      debtDeducted: 140000,
      exportedTotal: null,
    });
    expect(byW['503']).toMatchObject({
      status: WholesalerSettlementStatus.VOID,
      totalAmount: 0,
    });
    expect(await balance('WHOLESALER', '501')).toBe(0);
    await expect(
      svc.markPaid({ id: byW['501'].id, paidBy: '7' }),
    ).rejects.toMatchObject({ status: 409 });
    await expectBalanced();
  });

  it('bank faylidan keyin qayta ishga tushirish aktga qator qo‘shmaydi — keyingi haftaga qoladi', async () => {
    await window(10);
    await deliver('501', '2026-12-28T10:00:00.000Z');
    const late = await deliver('501', '2026-12-29T10:00:00.000Z', false); // Elchi puli hali kelmagan
    await svc.run({ asOf: MONDAY });
    await svc.bankFile({ periodEnd: '2027-01-10' });
    await ledger.onRemittance({
      schemaVersion: 2,
      eventId: `rem-${late}`,
      orderId: late,
      shipmentId: `s-${late}`,
      elchiStatus: 'paid',
      collectedFromCustomer: 291000,
      elchiFee: 40000,
      marketPaidAmount: 251000,
      occurredAt: '2027-01-12T10:00:00.000Z',
    });
    expect((await svc.run({ asOf: MONDAY })).items).toBe(0);
    expect(
      (await svc.list({ query: { periodEnd: '2027-01-10' } })).items[0],
    ).toMatchObject({
      itemsCount: 1,
      exportedTotal: 140000,
    });
    expect((await svc.run({ asOf: '2027-01-18T04:00:00.000Z' })).items).toBe(1);
  });

  it('noto‘g‘ri kiritma — 400 (kelajak lahza, mavjud bo‘lmagan sana); yo‘q akt — 404', async () => {
    await expect(svc.run({ asOf: 'ertaga' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      svc.run({ asOf: '2027-03-05T00:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(svc.get({ id: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.get({ id: '999' })).rejects.toMatchObject({ status: 404 });
    await expect(
      svc.bankFile({ periodEnd: '2027-1-10' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.bankFile({ periodEnd: '2027-02-30' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.list({ query: { wholesalerId: 'W' } }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
