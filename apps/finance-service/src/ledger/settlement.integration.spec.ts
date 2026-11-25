import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import { WholesalerSettlementStatus } from '@app/common';
import { CreateFinanceTables1724673600000 } from '../migrations/1724673600000-create-finance-tables';
import { CreateCodReconciliation1724932800000 } from '../migrations/1724932800000-create-cod-reconciliation';
import { CreatePayoutSchedule1727568000000 } from '../migrations/1727568000000-create-payout-schedule';
import { CreateLedger1795478400000 } from '../migrations/1795478400000-create-ledger';
import { AddJournalLeadIndex1795564800000 } from '../migrations/1795564800000-add-journal-lead-index';
import { CreateWithdrawal1795651200000 } from '../migrations/1795651200000-create-withdrawal';
import { CreateWholesalerSettlement1795737600000 } from '../migrations/1795737600000-create-wholesaler-settlement';
import { CreateFeeHold1795824000000 } from '../migrations/1795824000000-create-fee-hold';
import { AddRemittanceResolution1796860800000 } from '../migrations/1796860800000-add-remittance-resolution';
import { CreateSettlementResponse1796947200000 } from '../migrations/1796947200000-create-settlement-response';
import { CreateTextSetting1796774400000 } from '../migrations/1796774400000-create-text-setting';
import { BalanceCheckService } from './balance-check.service';
import { LedgerService } from './ledger.service';
import { orderEvent } from './order-events.samples';
import {
  bankCell,
  paymentPurpose,
  SettlementService,
  SKIPPED_NO_WINDOW,
  SKIPPED_PERIOD_EXPORTED,
} from './settlement.service';
import { WholesalerBalanceService } from './wholesaler-balance.service';

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
  // BE-33: oluvchi rekvizitlari katalogdan; `noDetails` dagilar — rekvizitsiz
  const noDetails = new Set<string>();
  const noBankName = new Set<string>();
  const noContract = new Set<string>();
  const catalog = {
    send: jest.fn((_pattern: unknown, data: { ids: string[] }) =>
      of(
        data.ids.map((id) => ({
          id,
          name: `Optovik ${id} MCHJ`,
          tin: noDetails.has(id) ? null : '301234567',
          bankName: noBankName.has(id) ? null : 'Ipoteka bank',
          bankAccount: noDetails.has(id) ? null : '20208000900123456789',
          bankMfo: '00450',
          contractNumber: noContract.has(id) ? null : 'K-12',
          contractDate: '2026-12-01',
        })),
      ),
    ),
  };
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
        CreateFeeHold1795824000000,
        AddRemittanceResolution1796860800000,
        CreateSettlementResponse1796947200000,
        CreateTextSetting1796774400000,
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
    svc = new SettlementService(ds, ledger, catalog as never);
    // BE-33 (QA): to‘lovchi rekvizitlari — bank fayli shularsiz chiqmaydi (EQ-05)
    await svc.updateSettings({
      dto: {
        payerName: 'Elchi Marketplace MChJ',
        payerTin: '305000000',
        payerAccount: '20208000900100000001',
        payerMfo: '01158',
        payerBankName: 'Kapitalbank',
        paymentPurposeCode: '00668',
      },
      changedBy: '1',
    });
    check = new BalanceCheckService(ds);
  }, 300_000);

  beforeEach(async () => {
    await ds.query(`TRUNCATE finance.settlement_dispute, finance.wholesaler_settlement_item, finance.wholesaler_settlement,
      finance.withdrawal_approval, finance.withdrawal_request, finance.affiliate_payout_profile,
      finance.ledger_entry, finance.journal, finance.remittance_item, finance.elchi_remittance,
      finance.balance_check, finance.processed_event, finance.event_failure, finance.fee_hold`);
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
    // Nizom 3229, 13-band rekvizitlari (summani so‘z bilan va imzoni bank tizimi qo‘yadi)
    expect(csv.split('\r\n')[0]).toBe(
      '﻿Hujjat;Hujjat raqami;Sana;To‘lovchi;To‘lovchi STIR;To‘lovchi h/r;To‘lovchi banki;To‘lovchi MFO;Oluvchi;Oluvchi STIR;Oluvchi h/r;Oluvchi banki;Oluvchi MFO;Summa;To‘lov maqsadi kodi;To‘lov maqsadi',
    );
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3); // sarlavha + 2 optovik
    expect(csv).toContain(';280000;');
    // BE-33 (QA): to‘lovchi (platforma) va maqsad kodi — sozlamadan
    expect(csv).toMatch(
      /\r\nTo‘lov topshiriqnomasi;AS-\d{6};\d{4}-\d{2}-\d{2};Elchi Marketplace MChJ;305000000;20208000900100000001;Kapitalbank;01158;Optovik/,
    );
    expect(csv).toMatch(/;280000;00668;|;\d+;00668;/);
    // BE-33 (QA): oluvchi — katalogdagi nom, STIR, hisob raqami, MFO
    expect(csv).toMatch(
      /;Optovik \S+ MCHJ;301234567;20208000900123456789;Ipoteka bank;00450;/,
    );
    // to‘lov tafsiloti: shartnoma raqami va sanasi, davr, akt
    expect(csv).toMatch(
      /;K-12-sonli 01\.12\.2026 sanadagi komissiya shartnomasi bo‘yicha sotilgan tovarlar uchun, akt AS-\d{6}, 04\.01\.2027–10\.01\.2027\r\n/,
    );
    expect(csv).not.toContain('Optovik #');
  });

  it('BE-33: optovik rekvizitlari to‘liq bo‘lmasa — 409, akt muzlatilmaydi (keyin to‘ldirilsa — fayl chiqadi)', async () => {
    await window(10);
    await deliver('501', '2026-12-28T10:00:00.000Z');
    await svc.run({ asOf: MONDAY });
    const [{ wholesalerId }] = (await ds.query(
      `SELECT wholesaler_id AS "wholesalerId" FROM finance.wholesaler_settlement`,
    )) as Array<{ wholesalerId: string }>;
    // STIR va hisob, faqat bank nomi, faqat shartnoma — har biri alohida to‘sadi
    for (const set of [noBankName, noContract]) {
      set.add(String(wholesalerId));
      await expect(svc.bankFile({ periodEnd: '2027-01-10' })).rejects.toThrow(
        'rekvizitlari to‘liq emas',
      );
      set.clear();
    }
    noDetails.add(String(wholesalerId));
    try {
      await expect(svc.bankFile({ periodEnd: '2027-01-10' })).rejects.toThrow(
        'rekvizitlari to‘liq emas',
      );
      const statuses = (await ds.query(
        `SELECT status FROM finance.wholesaler_settlement`,
      )) as Array<{ status: string }>;
      expect(statuses.every((r) => r.status === 'READY')).toBe(true);
    } finally {
      noDetails.clear();
    }
    await expect(
      svc.bankFile({ periodEnd: '2027-01-10' }),
    ).resolves.toMatchObject({ contentType: 'text/csv; charset=utf-8' });
  });

  it('BE-33: to‘lovchining bitta rekviziti yo‘q bo‘lsa xabarda aynan o‘sha aytiladi', async () => {
    await window(10);
    await deliver('501', '2026-12-28T10:00:00.000Z');
    await svc.run({ asOf: MONDAY });
    const [row] = (await ds
      .query(
        `DELETE FROM finance.text_setting WHERE key = 'payer_bank_name' RETURNING key, value, effective_from`,
      )
      .then((r: unknown[]) => (Array.isArray(r[0]) ? r[0] : r))) as Array<{
      value: string;
      effective_from: Date;
    }>;
    try {
      await expect(svc.bankFile({ periodEnd: '2027-01-10' })).rejects.toThrow(
        'sozlanmagan: bank nomi (',
      );
    } finally {
      await ds.query(
        `INSERT INTO finance.text_setting (key, value, effective_from, changed_by) VALUES ('payer_bank_name', $1, $2, '1')`,
        [row.value, row.effective_from],
      );
    }
  });

  it('BE-33: to‘lov maqsadi — shartnoma bo‘lmasa yoki sanasiz bo‘lsa ham to‘g‘ri matn', () => {
    const p = (contractNumber: string | null, contractDate: string | null) =>
      paymentPurpose(
        { contractNumber, contractDate },
        '2027-01-04',
        '2027-01-10',
        '12',
      );
    const tail =
      'sotilgan tovarlar uchun, akt AS-000012, 04.01.2027–10.01.2027';
    expect(p(null, null)).toBe(tail);
    expect(p('  ', '2026-12-01')).toBe(tail);
    expect(p('K-12', null)).toBe(
      `K-12-sonli komissiya shartnomasi bo‘yicha ${tail}`,
    );
    expect(p('K-12', '2026-12-01')).toBe(
      `K-12-sonli 01.12.2026 sanadagi komissiya shartnomasi bo‘yicha ${tail}`,
    );
  });

  it('BE-33: bank fayli katagi — bitta hujjat bitta qator, formula ochilmaydi', () => {
    expect(bankCell('Optovik\r\nMCHJ\t1')).toBe('Optovik MCHJ 1');
    expect(bankCell('=HYPERLINK("http://x")')).toBe(
      '"HYPERLINK(""http://x"")"',
    );
    expect(bankCell(' +@-Bank')).toBe('Bank');
    expect(bankCell('A;B')).toBe('"A;B"');
    expect(bankCell('20208000900123456789')).toBe('20208000900123456789');
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
    // BE-30 (OPT-3): optovik paneli — to‘langan 140 000, to‘lanadigan 0, ushlab turilgan yo‘q; boshqa optovik — 0
    await expect(
      new WholesalerBalanceService(ds).balance({ wholesalerId: '501' }),
    ).resolves.toEqual({ held: 0, payable: 0, paid: 140000 });
    await expect(
      new WholesalerBalanceService(ds).balance({ wholesalerId: '999' }),
    ).resolves.toEqual({ held: 0, payable: 0, paid: 0 });
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

  it('BE-30 (QA 2026-11-23): panel «sotilgan» — yetkazilgan va teskari yozilmagan dona (HOLD ham), pul bilan bir hisob; boshqa optovik alohida', async () => {
    const balances = new WholesalerBalanceService(ds);
    const held = await deliver('501', '2027-01-04T10:00:00.000Z', false); // Elchi puli kelmagan — HOLD
    await deliver('501', '2027-01-05T10:00:00.000Z'); // AVAILABLE
    await deliver('502', '2027-01-05T11:00:00.000Z');
    await expect(balances.soldUnits({ wholesalerId: '501' })).resolves.toEqual([
      { productId: '88', quantity: 2 },
    ]);
    await expect(
      balances.balance({ wholesalerId: '501' }),
    ).resolves.toMatchObject({ held: 140000, payable: 140000 });
    // qaytgan (teskari yozilgan) buyurtma sotilgan emas — pul ham ayriladi
    await ledger.onOrderReturned({
      eventId: `ret-${held}`,
      orderId: held,
      returnRequestId: `RR-${held}`,
      items: [{ productId: '88', quantity: 1 }],
      occurredAt: '2027-01-06T10:00:00.000Z',
    });
    await expect(balances.soldUnits({ wholesalerId: '501' })).resolves.toEqual([
      { productId: '88', quantity: 1 },
    ]);
    await expect(
      balances.balance({ wholesalerId: '501' }),
    ).resolves.toMatchObject({ held: 0, payable: 140000 });
    await expect(balances.soldUnits({ wholesalerId: '502' })).resolves.toEqual([
      { productId: '88', quantity: 1 },
    ]);
    await expect(balances.soldUnits({ wholesalerId: '999' })).resolves.toEqual(
      [],
    );
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

  it('bank faylidan keyin qo‘lda run boshqa optovikka akt tuzmaydi; fayl qayta yuklansa summa ikki marta chiqmaydi', async () => {
    await window(10);
    await deliver('501', '2026-12-28T10:00:00.000Z');
    const late = await deliver('502', '2026-12-28T10:00:00.000Z', false); // Elchi puli hali kelmagan
    expect(await svc.run({ asOf: MONDAY })).toMatchObject({
      settlements: 1,
      items: 1,
    });
    const lines = async (periodEnd: string) =>
      Buffer.from((await svc.bankFile({ periodEnd })).base64, 'base64')
        .toString('utf8')
        .split('\r\n')
        .filter(Boolean)
        .slice(1);
    const first = await lines('2027-01-10');
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('Optovik 501 MCHJ;');
    // Fayl bankka ketdi; 502 ning puli keldi va moliya qo‘lda run bosdi
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
    expect(await svc.run({ asOf: MONDAY })).toEqual({
      periodEnd: '2027-01-10',
      skipped: SKIPPED_PERIOD_EXPORTED,
      settlements: 0,
      items: 0,
    });
    expect((await svc.list({ query: { periodEnd: '2027-01-10' } })).total).toBe(
      1,
    );
    // Qayta yuklangan fayl — o‘sha bitta qator, 501 ikkinchi marta to‘lanmaydi
    expect(await lines('2027-01-10')).toEqual(first);
    // 502 keyingi hafta aktida, o‘z faylida bir marta
    expect(await svc.run({ asOf: '2027-01-18T04:00:00.000Z' })).toMatchObject({
      skipped: null,
      settlements: 1,
      items: 1,
    });
    const second = await lines('2027-01-17');
    expect(second).toHaveLength(1);
    expect(second[0]).toContain('Optovik 502 MCHJ;');
    expect(second[0]).toContain(';140000;');
  });

  it('bank fayli ishga tushirish qulfini kutadi: run tugamaguncha akt muzlatilmaydi', async () => {
    await window(10);
    await deliver('501', '2026-12-28T10:00:00.000Z');
    await svc.run({ asOf: MONDAY });
    const [s] = (await svc.list({ query: {} })).items;
    const holder = new Client({ connectionString: url });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        2304,
        'finance-wholesaler-settlement',
      ]);
      let done = false;
      const file = svc.bankFile({ periodEnd: '2027-01-10' }).finally(() => {
        done = true;
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(done).toBe(false);
      expect((await svc.get({ id: s.id })).status).toBe(
        WholesalerSettlementStatus.READY,
      );
      await holder.query('COMMIT');
      await file;
      expect((await svc.get({ id: s.id })).status).toBe(
        WholesalerSettlementStatus.EXPORTED,
      );
    } finally {
      await holder.end();
    }
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

  it('BE-33 (QA): to‘lovchi rekvizitlari bo‘lmasa bank fayli chiqmaydi (409); sozlamalar tarixda, qaytarish muddati ham', async () => {
    await window(10);
    await deliver('501', '2026-12-28T10:00:00.000Z');
    await svc.run({ asOf: MONDAY });
    const saved = (await ds.query(
      `SELECT key, value, effective_from FROM finance.text_setting`,
    )) as Array<{ key: string; value: string; effective_from: Date }>;
    await ds.query('DELETE FROM finance.text_setting');
    try {
      await expect(svc.bankFile({ periodEnd: '2027-01-10' })).rejects.toThrow(
        'To‘lovchi (platforma) rekvizitlari sozlanmagan',
      );
      const statuses = (await ds.query(
        `SELECT status FROM finance.wholesaler_settlement`,
      )) as Array<{ status: string }>;
      expect(statuses.every((r) => r.status === 'READY')).toBe(true);
    } finally {
      for (const row of saved)
        await ds.query(
          `INSERT INTO finance.text_setting (key, value, effective_from, changed_by) VALUES ($1, $2, $3, '1')`,
          [row.key, row.value, row.effective_from],
        );
    }
    await expect(
      svc.updateSettings({ dto: { payerMfo: '1158' }, changedBy: '1' }),
    ).rejects.toThrow('payer_mfo');
    const updated = await svc.updateSettings({
      dto: { payerMfo: '00450', returnWindowDays: 14 },
      changedBy: '7',
    });
    expect(updated).toMatchObject({
      payerMfo: '00450',
      payerAccount: '20208000900100000001',
    });
    await expect(
      svc.updateSettings({ dto: { payerBankName: ' ' }, changedBy: '1' }),
    ).rejects.toThrow('payer_bank_name');
    const history = (await ds.query(
      `SELECT value, changed_by AS "by" FROM finance.text_setting WHERE key = 'payer_mfo' ORDER BY effective_from`,
    )) as Array<{ value: string; by: string }>;
    expect(history.map((h) => h.value)).toEqual(['01158', '00450']);
    expect(history[1].by).toBe('7');
  });
});
