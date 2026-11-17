import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { FinanceRemittanceEvent, LeadOrderStatus } from '@app/common';
import { CreateFinanceTables1724673600000 } from '../migrations/1724673600000-create-finance-tables';
import { CreateCodReconciliation1724932800000 } from '../migrations/1724932800000-create-cod-reconciliation';
import { CreatePayoutSchedule1727568000000 } from '../migrations/1727568000000-create-payout-schedule';
import { CreateLedger1795478400000 } from '../migrations/1795478400000-create-ledger';
import { BalanceCheckService } from './balance-check.service';
import { LedgerService } from './ledger.service';
import { orderEvent } from './order-events.samples';

const url = process.env.FINANCE_TEST_DATABASE_URL;
const describePostgres = url ? describe : describe.skip;

/**
 * BE-22 TC0–TC8 haqiqiy Postgres da. Har test oxirida kechki balans
 * tekshiruvi: farq 0 (qabul mezoni).
 */
describePostgres('BE-22 hisoblar va taqsimot (PostgreSQL)', () => {
  let ds: DataSource;
  let ledger: LedgerService;
  let check: BalanceCheckService;

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
  const balances = async () =>
    Object.fromEntries(
      (
        (await ds.query(
          `SELECT type || CASE WHEN owner_id <> '' THEN ':' || owner_id ELSE '' END AS k,
                  hold_balance::int AS hold, available_balance::int AS available
             FROM finance.account WHERE hold_balance <> 0 OR available_balance <> 0`,
        )) as Array<{ k: string; hold: number; available: number }>
      ).map((r) => [r.k, { hold: r.hold, available: r.available }]),
    );
  const count = async (sql: string) => Number((await ds.query(sql))[0].n);
  const expectBalanced = async () => {
    const result = await check.run();
    expect(result.details.unbalancedJournals).toEqual([]);
    expect(result.details.accounts).toEqual([]);
    expect(result.ok).toBe(true);
  };

  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_finance_test')) {
      throw new Error(
        'FINANCE_TEST_DATABASE_URL nomi _finance_test bilan tugashi kerak',
      );
    }
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
      ],
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    ledger = new LedgerService(ds);
    check = new BalanceCheckService(ds);
  });

  beforeEach(async () => {
    await ds.query(`TRUNCATE finance.ledger_entry, finance.journal, finance.remittance_item,
      finance.elchi_remittance, finance.balance_check, finance.processed_event, finance.event_failure`);
    await ds.query(`DELETE FROM finance.account WHERE owner_id <> ''`);
    await ds.query(
      `UPDATE finance.account SET hold_balance = 0, available_balance = 0`,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS finance CASCADE');
      await ds.destroy();
    }
  });

  it('TC1: 251 000 yetkazildi → optovik 140 000, sotuvchi 65 000, markaz 12 000, platforma 34 000 — HOLD', async () => {
    await ledger.onOrderStatusChanged(orderEvent());
    expect(await balances()).toEqual({
      'WHOLESALER:W': { hold: 140000, available: 0 },
      'AFFILIATE:A': { hold: 65000, available: 0 },
      CALL_CENTER: { hold: 12000, available: 0 },
      PLATFORM_SERVICE: { hold: 34000, available: 0 },
      COD_CLEARING: { hold: -251000, available: 0 },
    });
    await expectBalanced();
  });

  it('TC0: A sotuvchi sahifasidan kelgan sotuv → haq A ga, shu mahsulotni sotayotgan B ga emas', async () => {
    await ledger.onOrderStatusChanged(
      orderEvent({ affiliateId: 'B', eventId: 'e-b', orderId: '500' }),
    );
    await ledger.onOrderStatusChanged(orderEvent({ affiliateId: 'A' }));
    const b = await balances();
    expect(b['AFFILIATE:A']).toEqual({ hold: 65000, available: 0 });
    expect(b['AFFILIATE:B']).toEqual({ hold: 65000, available: 0 }); // faqat o'z buyurtmasi (500)
    const rows = await ds.query(
      `SELECT a.owner_id AS owner FROM finance.ledger_entry e JOIN finance.journal j ON j.id = e.journal_id
         JOIN finance.account a ON a.id = e.account_id WHERE j.order_id = '501' AND a.type = 'AFFILIATE'`,
    );
    expect(rows).toEqual([{ owner: 'A' }]);
    await expectBalanced();
  });

  it('TC2: Elchi o‘tkazmasi → AVAILABLE; ikkinchi o‘tkazma hech narsani o‘zgartirmaydi', async () => {
    await ledger.onOrderStatusChanged(orderEvent());
    await ledger.onRemittance(remittance());
    const after = await balances();
    expect(after['AFFILIATE:A']).toEqual({ hold: 0, available: 65000 });
    expect(after['WHOLESALER:W']).toEqual({ hold: 0, available: 140000 });
    await ledger.onRemittance(remittance({ eventId: 'rem-501-b' }));
    expect(await balances()).toEqual(after);
    const items = await ds.query(
      `SELECT match_state AS m, diff::int AS diff FROM finance.remittance_item ORDER BY id`,
    );
    expect(items).toEqual([
      { m: 'MATCHED', diff: 0 },
      { m: 'MATCHED', diff: 0 },
    ]);
    await expectBalanced();
  });

  it('hisob-kitobdan keyin boshqa summali o‘tkazma → MISMATCH, balans o‘zgarmaydi', async () => {
    await ledger.onOrderStatusChanged(orderEvent());
    await ledger.onRemittance(remittance());
    const after = await balances();
    await ledger.onRemittance(
      remittance({ eventId: 'rem-501-extra', marketPaidAmount: 10000 }),
    );
    expect(await balances()).toEqual(after);
    const rows = await ds.query(
      `SELECT match_state AS m, diff::int AS diff FROM finance.remittance_item ORDER BY id`,
    );
    expect(rows).toEqual([
      { m: 'MATCHED', diff: 0 },
      { m: 'MISMATCH', diff: 10000 },
    ]);
    await expectBalanced();
  });

  it('TC3: rad → faqat platformaga −20 000 (Elchi ga +20 000); sotuvchi, optovik, markazga yozuv yo‘q', async () => {
    await ledger.onOrderStatusChanged(
      orderEvent({ status: LeadOrderStatus.REFUSED, eventId: 'evt-refused' }),
    );
    expect(await balances()).toEqual({
      PLATFORM_SERVICE: { hold: -20000, available: 0 },
      ELCHI: { hold: 20000, available: 0 },
    });
    expect(
      await count(`SELECT count(*) AS n FROM finance.ledger_entry e JOIN finance.account a ON a.id = e.account_id
                    WHERE a.type IN ('AFFILIATE','WHOLESALER','CALL_CENTER')`),
    ).toBe(0);
    // Elchi to'lovni ushladi — AVAILABLE va Elchi qarzi yopiladi
    await ledger.onRemittance(
      remittance({
        eventId: 'rem-refused',
        elchiStatus: 'closed',
        collectedFromCustomer: 0,
        elchiFee: 0,
        marketPaidAmount: 0,
        refusalFee: 20000,
      }),
    );
    expect((await balances())['PLATFORM_SERVICE']).toEqual({
      hold: 0,
      available: -20000,
    });
    await expectBalanced();
  });

  it('TC4: yetkazilgandan keyin qaytarish → teskari yozuvlar; HOLD balanslar 0', async () => {
    await ledger.onOrderStatusChanged(orderEvent());
    await ledger.onOrderReturned({
      eventId: 'evt-return',
      orderId: '501',
      returnRequestId: 'RR-1',
      items: [{ productId: '88', quantity: 1 }],
      occurredAt: '2026-12-22T10:00:00.000Z',
    });
    expect(await balances()).toEqual({});
    expect(
      await count(
        `SELECT count(*) AS n FROM finance.ledger_entry WHERE state = 'REVERSED'`,
      ),
    ).toBe(10); // 5 asl + 5 ko'zgu
    await expectBalanced();
  });

  it('TC4: o‘tkazmadan keyin qaytarish → sotuvchi mavjud balansi 0 ga qaytadi, keyingi daromad qo‘shiladi', async () => {
    await ledger.onOrderStatusChanged(orderEvent());
    await ledger.onRemittance(remittance());
    await ledger.onOrderReturned({
      eventId: 'evt-return',
      orderId: '501',
      returnRequestId: 'RR-1',
      items: [{ productId: '88', quantity: 1 }],
      occurredAt: '2026-12-22T10:00:00.000Z',
    });
    // o'tkazilgan pul qaytarildi: mavjud balans 0 (manfiy faqat pul yechilgandan keyin — BE-23)
    expect((await balances())['AFFILIATE:A']).toBeUndefined();
    await ledger.onOrderStatusChanged(
      orderEvent({ eventId: 'evt-502', orderId: '502' }),
    );
    await ledger.onRemittance(
      remittance({ eventId: 'rem-502', orderId: '502' }),
    );
    expect((await balances())['AFFILIATE:A']).toEqual({
      hold: 0,
      available: 65000,
    });
    await expectBalanced();
  });

  it('TC5: bir webhook 2 marta, yangi eventId bilan ham, parallel ham → taqsimot bir marta', async () => {
    await ledger.onOrderStatusChanged(orderEvent());
    await ledger.onOrderStatusChanged(orderEvent());
    await ledger.onOrderStatusChanged(
      orderEvent({ eventId: 'evt-delivered-501-again' }),
    );
    await Promise.all([
      ledger.onOrderStatusChanged(
        orderEvent({ eventId: 'p1', orderId: '600' }),
      ),
      ledger.onOrderStatusChanged(
        orderEvent({ eventId: 'p2', orderId: '600' }),
      ),
      ledger.onOrderStatusChanged(
        orderEvent({ eventId: 'p3', orderId: '601' }),
      ),
    ]);
    expect(
      await count(
        `SELECT count(*) AS n FROM finance.journal WHERE kind = 'ORDER_DELIVERED'`,
      ),
    ).toBe(3);
    expect((await balances())['AFFILIATE:A']).toEqual({
      hold: 195000,
      available: 0,
    });
    await expectBalanced();
  });

  it('TC6, TC7, TC8: ustama va qisman rejim yozuvlari', async () => {
    await ledger.onOrderStatusChanged(orderEvent({}, { salePrice: 276000 }));
    await ledger.onOrderStatusChanged(
      orderEvent({ eventId: 'e7', orderId: '507' }, { salePrice: 276010 }),
    );
    await ledger.onOrderStatusChanged(
      orderEvent(
        {
          eventId: 'e8',
          orderId: '508',
          delivery: { mode: 'PARTIAL', cost: 30000 },
        },
        {
          approvedPrice: 262000,
          salePrice: 287000,
          split: {
            affiliateFee: 65000,
            callCenterFee: 12000,
            hiddenDelivery: 10000,
          },
        },
      ),
    );
    const b = await balances();
    expect(b['AFFILIATE:A'].hold).toBe(86250 + 65000 + 21258 + 86250);
    expect(b['ELCHI']).toEqual({ hold: 10000, available: 0 });
    // qisman rejim o'tkazmasi: Elchi yashirilgan 10 000 ni o'zida qoldiradi
    await ledger.onRemittance(
      remittance({
        eventId: 'rem-508',
        orderId: '508',
        collectedFromCustomer: 317000,
        elchiFee: 40000,
        marketPaidAmount: 277000,
      }),
    );
    expect((await balances())['ELCHI']).toBeUndefined(); // +10 000 HOLD → AVAILABLE, −10 000 o'tkazmada
    await expectBalanced();
  });

  it('o‘tkazma «yetkazildi» dan oldin kelsa kutadi, keyin qo‘llanadi; kam to‘lov — MISMATCH', async () => {
    await ledger.onRemittance(remittance());
    expect(
      (
        await ds.query(`SELECT match_state AS m FROM finance.remittance_item`)
      )[0].m,
    ).toBe('PENDING');
    await ledger.onOrderStatusChanged(orderEvent());
    expect((await balances())['AFFILIATE:A']).toEqual({
      hold: 0,
      available: 65000,
    });

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
    expect(
      (
        await ds.query(
          `SELECT match_state AS m FROM finance.remittance_item WHERE order_id='509'`,
        )
      )[0].m,
    ).toBe('MISMATCH');
    expect((await balances())['WHOLESALER:W']).toEqual({
      hold: 140000,
      available: 140000,
    });
    await expectBalanced();
  });

  it('noto‘g‘ri hodisa event_failure ga yoziladi, pul yozilmaydi', async () => {
    await ledger.onOrderStatusChanged(
      orderEvent({ eventId: 'bad' }, { salePrice: 250000 }),
    );
    expect(await count(`SELECT count(*) AS n FROM finance.journal`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM finance.event_failure`)).toBe(
      1,
    );
  });

  it('kechki tekshiruv kesh buzilsa farqni topadi', async () => {
    await ledger.onOrderStatusChanged(orderEvent());
    await ds.query(
      `UPDATE finance.account SET hold_balance = hold_balance + 7 WHERE type = 'CALL_CENTER'`,
    );
    const result = await check.run();
    expect(result.ok).toBe(false);
    expect(result.diffAbsTotal).toBe(7);
  });
});
