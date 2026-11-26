import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { WithdrawalBlockReason, WithdrawalStatus } from '@app/common';
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
import { CreateSelfEmployed1798761600000 } from '../migrations/1798761600000-create-self-employed';
import { CreatePayoutCard1799107200000 } from '../migrations/1799107200000-create-payout-card';
import { BalanceCheckService } from './balance-check.service';
import { LedgerQueryService } from './ledger-query.service';
import { LedgerService } from './ledger.service';
import { orderEvent } from './order-events.samples';
import { SelfEmployedService } from './self-employed.service';
import { withdrawalTax, WithdrawalService } from './withdrawal.service';

const url = process.env.FINANCE_TEST_DATABASE_URL;
const describePostgres = url ? describe : describe.skip;
/** Session advisory lock: finance sxemasi testlari ketma-ket (BE-23 tekshiruvi). */
const FINANCE_SCHEMA_TEST_LOCK = 2_304_001;
let schemaLock: Client | undefined;

describe('withdrawalTax (1%)', () => {
  it('TC1: 1 000 000 → 10 000; kasr yuqoriga (soliq kam ushlanmaydi)', () => {
    expect(withdrawalTax(1_000_000)).toBe(10_000);
    expect(withdrawalTax(50_000)).toBe(500);
    expect(withdrawalTax(50_050)).toBe(501);
  });
});

/** BE-23 pul yechish — haqiqiy PostgreSQL; har test oxirida kechki balans tekshiruvi farqsiz. */
describePostgres('BE-23 pul yechish (PostgreSQL)', () => {
  let ds: DataSource;
  let ledger: LedgerService;
  let svc: WithdrawalService;
  let check: BalanceCheckService;
  let seq = 0;

  /** Sotuvchiga «mavjud» pul: yetkazilgan buyurtma (haq = fee) va Elchi o‘tkazmasi (HOLD → AVAILABLE). */
  const fund = async (affiliateId: string, fee: number) => {
    const orderId = String(800 + ++seq);
    const approved = 140000 + fee + 12000;
    await ledger.onOrderStatusChanged(
      orderEvent(
        {
          eventId: `d-${orderId}`,
          orderId,
          leadId: String(9000 + seq),
          affiliateId,
          codAmount: approved + 40000,
        },
        {
          approvedPrice: approved,
          salePrice: approved,
          basePrice: 140000,
          split: { affiliateFee: fee, callCenterFee: 12000, hiddenDelivery: 0 },
        },
      ),
    );
    await ledger.onRemittance({
      schemaVersion: 2,
      eventId: `rem-${orderId}`,
      orderId,
      shipmentId: `s-${orderId}`,
      elchiStatus: 'paid',
      collectedFromCustomer: approved + 40000,
      elchiFee: 40000,
      marketPaidAmount: approved,
      occurredAt: '2026-12-21T10:00:00.000Z',
    });
    return orderId;
  };
  const balances = async () =>
    Object.fromEntries(
      (
        (await ds.query(
          `SELECT type || CASE WHEN owner_id <> '' THEN ':' || owner_id ELSE '' END AS k,
                  hold_balance::int AS hold, available_balance::bigint::text AS available
             FROM finance.account WHERE type IN ('AFFILIATE', 'TAX')`,
        )) as Array<{ k: string; hold: number; available: string }>
      ).map((r) => [r.k, Number(r.available)]),
    );
  const expectBalanced = async () => {
    const result = await check.run();
    expect(result.details.unbalancedJournals).toEqual([]);
    expect(result.details.accounts).toEqual([]);
    expect(result.ok).toBe(true);
  };
  const selfEmployed = (affiliateId = '42', value = true) =>
    new SelfEmployedService(ds, {
      get: () => undefined,
    } as never).setManually({
      affiliateId,
      selfEmployed: value,
      updatedBy: '7',
      fullName: 'Sotuvchi',
    });
  const count = async (sql: string, p: unknown[] = []) =>
    Number((await ds.query(sql, p))[0].n);

  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_finance_test'))
      throw new Error(
        'FINANCE_TEST_DATABASE_URL nomi _finance_test bilan tugashi kerak',
      );
    // finance sxemasini DROP/CREATE qiladigan integratsiya testlari (ledger, withdrawal) parallel workerda bir-birini buzmasin
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
        CreateSelfEmployed1798761600000,
        CreatePayoutCard1799107200000,
      ],
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    ledger = new LedgerService(ds);
    svc = new WithdrawalService(ds, ledger);
    check = new BalanceCheckService(ds);
  }, 300_000);

  beforeEach(async () => {
    await ds.query(`TRUNCATE finance.settlement_dispute, finance.wholesaler_settlement_item, finance.wholesaler_settlement, finance.withdrawal_approval, finance.withdrawal_request, finance.affiliate_payout_profile, finance.self_employed_application,
      finance.ledger_entry, finance.journal, finance.remittance_item, finance.elchi_remittance,
      finance.balance_check, finance.processed_event, finance.event_failure, finance.fee_hold`);
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
    await schemaLock?.end(); // sessiya yopilsa qulf bo‘shaydi
  });

  it('TC1: 1 000 000 → 10 000 soliq (alohida qator), 990 000 kartaga; balans 0, soliq hisobida 10 000', async () => {
    await fund('42', 1_000_000);
    await selfEmployed();
    expect(await svc.balance({ affiliateId: '42' })).toMatchObject({
      hold: 0,
      available: 1_000_000,
      reserved: 0,
      withdrawable: 1_000_000,
      minAmount: 50000,
      taxPercent: 1,
      selfEmployed: true,
      blockReason: null,
    });
    const req = await svc.create({ affiliateId: '42', amount: 1_000_000 });
    expect(req).toMatchObject({
      amount: 1_000_000,
      taxAmount: 10_000,
      netAmount: 990_000,
      status: WithdrawalStatus.REQUESTED,
      requiredApprovals: 1,
    });
    // So‘rov ledgerga yozilmaydi — summa band
    expect(await svc.balance({ affiliateId: '42' })).toMatchObject({
      available: 1_000_000,
      reserved: 1_000_000,
      withdrawable: 0,
      blockReason: WithdrawalBlockReason.DAILY_LIMIT,
    });
    await svc.approve({
      id: req.id,
      approverId: '7',
      currentFullName: 'Sotuvchi',
    });
    const paid = await svc.markPaid({ id: req.id, paidBy: '7' });
    expect(paid).toMatchObject({
      status: WithdrawalStatus.PAID,
      paidBy: '7',
      approvals: [{ approvedBy: '7' }],
    });
    expect(await balances()).toEqual({ 'AFFILIATE:42': 0, TAX: 10_000 });
    const lines = await ds.query(
      `SELECT j.kind, j.order_id AS "orderId", j.affiliate_id AS "affiliateId", e.line_kind AS "lineKind",
              a.type, e.amount::int AS amount, e.state
         FROM finance.journal j JOIN finance.ledger_entry e ON e.journal_id = j.id
         JOIN finance.account a ON a.id = e.account_id
        WHERE j.kind = 'WITHDRAWAL_PAID' ORDER BY e.id`,
    );
    expect(lines).toEqual([
      {
        kind: 'WITHDRAWAL_PAID',
        orderId: null,
        affiliateId: '42',
        lineKind: 'WITHDRAWAL',
        type: 'AFFILIATE',
        amount: -1_000_000,
        state: 'AVAILABLE',
      },
      {
        kind: 'WITHDRAWAL_PAID',
        orderId: null,
        affiliateId: '42',
        lineKind: 'WITHDRAWAL_TAX',
        type: 'TAX',
        amount: 10_000,
        state: 'AVAILABLE',
      },
      {
        kind: 'WITHDRAWAL_PAID',
        orderId: null,
        affiliateId: '42',
        lineKind: 'WITHDRAWAL_NET',
        type: 'COD_CLEARING',
        amount: 990_000,
        state: 'AVAILABLE',
      },
    ]);
    // Takror «To‘landi» — ikkinchi jurnal yo‘q
    await svc.markPaid({ id: req.id, paidBy: '8' });
    expect(
      await count(
        `SELECT count(*) AS n FROM finance.journal WHERE kind = 'WITHDRAWAL_PAID'`,
      ),
    ).toBe(1);
    // BE-28 daromad statistikasi pul yechishdan o‘zgarmaydi
    const income = await new LedgerQueryService(ds).affiliateIncome({
      affiliateId: '42',
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(income.lines.map((l) => [l.kind, l.amount])).toEqual([
      ['DELIVERED', 1_000_000],
    ]);
    await expectBalanced();
  });

  it('TC2: 40 000 → rad (minimal 50 000); so‘rov yozilmaydi', async () => {
    await fund('42', 100_000);
    await selfEmployed();
    await expect(
      svc.create({ affiliateId: '42', amount: 40_000 }),
    ).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'BUSINESS_RULE_VIOLATION' },
    });
    expect(
      await count(`SELECT count(*) AS n FROM finance.withdrawal_request`),
    ).toBe(0);
    // Yechish mumkin summa minimaldan kam bo‘lsa — kabinetda tugma yopiq
    await svc.create({ affiliateId: '42', amount: 60_000 });
    await ds.query(
      `UPDATE finance.withdrawal_request SET request_day = request_day - 1`,
    );
    expect((await svc.balance({ affiliateId: '42' })).blockReason).toBe(
      WithdrawalBlockReason.BELOW_MIN,
    );
  });

  it('TC3: kuniga ikkinchi so‘rov → rad; rad etilgani kunni band qilmaydi, to‘langani band qiladi', async () => {
    await fund('42', 1_000_000);
    await selfEmployed();
    const first = await svc.create({ affiliateId: '42', amount: 100_000 });
    await expect(
      svc.create({ affiliateId: '42', amount: 100_000 }),
    ).rejects.toMatchObject({ status: 400 });
    await svc.reject({ id: first.id, rejectedBy: '7', reason: 'Tekshiruv' });
    const second = await svc.create({ affiliateId: '42', amount: 100_000 });
    await svc.approve({
      id: second.id,
      approverId: '7',
      currentFullName: 'Sotuvchi',
    });
    await svc.markPaid({ id: second.id, paidBy: '7' });
    await expect(
      svc.create({ affiliateId: '42', amount: 100_000 }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await svc.balance({ affiliateId: '42' })).blockReason).toBe(
      WithdrawalBlockReason.DAILY_LIMIT,
    );
    await expectBalanced();
  });

  it('TC4: 6 mln — bitta tasdiq bilan «To‘landi» bo‘lmaydi; bir xodim ikki marta tasdiqlay olmaydi', async () => {
    await fund('42', 6_000_000);
    await selfEmployed();
    const req = await svc.create({ affiliateId: '42', amount: 6_000_000 });
    expect(req.requiredApprovals).toBe(2);
    expect(
      (
        await svc.approve({
          id: req.id,
          approverId: '7',
          currentFullName: 'Sotuvchi',
        })
      ).status,
    ).toBe(WithdrawalStatus.REQUESTED);
    await expect(
      svc.markPaid({ id: req.id, paidBy: '7' }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'INVALID_STATE' },
    });
    await expect(
      svc.approve({ id: req.id, approverId: '7', currentFullName: 'Sotuvchi' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await svc.approve({
          id: req.id,
          approverId: '8',
          currentFullName: 'Sotuvchi',
        })
      ).status,
    ).toBe(WithdrawalStatus.APPROVED);
    expect((await svc.markPaid({ id: req.id, paidBy: '8' })).status).toBe(
      WithdrawalStatus.PAID,
    );
    // 5 000 000 ning o‘zi — bitta tasdiq
    await ds.query(
      `UPDATE finance.withdrawal_request SET request_day = request_day - 1`,
    );
    await fund('43', 5_000_000);
    await selfEmployed('43');
    expect(
      (await svc.create({ affiliateId: '43', amount: 5_000_000 }))
        .requiredApprovals,
    ).toBe(1);
    await expectBalanced();
  });

  it('TC5: o‘zini o‘zi band qilganlik belgisi yo‘q → rad; belgi olib tashlansa «To‘landi» ham bo‘lmaydi', async () => {
    await fund('42', 200_000);
    expect((await svc.balance({ affiliateId: '42' })).blockReason).toBe(
      WithdrawalBlockReason.NOT_SELF_EMPLOYED,
    );
    await expect(
      svc.create({ affiliateId: '42', amount: 100_000 }),
    ).rejects.toMatchObject({ status: 400 });
    await selfEmployed();
    const req = await svc.create({ affiliateId: '42', amount: 100_000 });
    await svc.approve({
      id: req.id,
      approverId: '7',
      currentFullName: 'Sotuvchi',
    });
    await selfEmployed('42', false);
    await expect(
      svc.markPaid({ id: req.id, paidBy: '7' }),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(
      await count(
        `SELECT count(*) AS n FROM finance.journal WHERE kind = 'WITHDRAWAL_PAID'`,
      ),
    ).toBe(0);
  });

  it('balans yetmasa rad; band summa hisobga olinadi; qaytarishdan keyin «To‘landi» bloklanadi', async () => {
    const orderId = await fund('42', 300_000);
    await selfEmployed();
    await expect(
      svc.create({ affiliateId: '42', amount: 300_001 }),
    ).rejects.toMatchObject({ status: 400 });
    const req = await svc.create({ affiliateId: '42', amount: 300_000 });
    await svc.approve({
      id: req.id,
      approverId: '7',
      currentFullName: 'Sotuvchi',
    });
    // Yetkazilgandan keyin qaytarish: mavjud balans 0 ga tushadi
    await ledger.onOrderReturned({
      eventId: 'ret-1',
      orderId,
      returnRequestId: 'RR-1',
      items: [{ productId: '88', quantity: 1 }],
      occurredAt: '2026-12-22T10:00:00.000Z',
    });
    await expect(
      svc.markPaid({ id: req.id, paidBy: '7' }),
    ).rejects.toMatchObject({
      status: 409,
    });
    const rejected = await svc.reject({
      id: req.id,
      rejectedBy: '7',
      reason: 'Buyurtma qaytarildi',
    });
    expect(rejected).toMatchObject({
      status: WithdrawalStatus.REJECTED,
      rejectReason: 'Buyurtma qaytarildi',
    });
    await expect(
      svc.reject({ id: req.id, rejectedBy: '7', reason: 'x' }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await svc.balance({ affiliateId: '42' })).reserved).toBe(0);
    await expectBalanced();
  });

  it('parallel ikki so‘rov — faqat bittasi yoziladi', async () => {
    await fund('42', 1_000_000);
    await selfEmployed();
    const results = await Promise.allSettled([
      svc.create({ affiliateId: '42', amount: 600_000 }),
      svc.create({ affiliateId: '42', amount: 600_000 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await count(`SELECT count(*) AS n FROM finance.withdrawal_request`),
    ).toBe(1);
  });

  it('ro‘yxatlar: sotuvchi faqat o‘zinikini, moliya holat va sotuvchi filtri bilan', async () => {
    await fund('42', 200_000);
    await fund('43', 200_000);
    await selfEmployed('42');
    await selfEmployed('43');
    const a = await svc.create({ affiliateId: '42', amount: 100_000 });
    await svc.create({ affiliateId: '43', amount: 100_000 });
    await svc.approve({
      id: a.id,
      approverId: '7',
      currentFullName: 'Sotuvchi',
    });
    const mine = await svc.listMine({ affiliateId: '42', query: {} });
    expect(mine).toMatchObject({ total: 1, page: 1, limit: 20, totalPages: 1 });
    expect(mine.items[0].affiliateId).toBe('42');
    expect(
      (
        await svc.adminList({ query: { status: WithdrawalStatus.APPROVED } })
      ).items.map((i) => i.id),
    ).toEqual([a.id]);
    expect((await svc.adminList({ query: { affiliateId: '43' } })).total).toBe(
      1,
    );
    expect((await svc.adminList({ query: {} })).total).toBe(2);
  });

  it('noto‘g‘ri kiritma — 400; yo‘q so‘rov — 404', async () => {
    for (const bad of [
      { affiliateId: 'abc', amount: 100_000 },
      { affiliateId: '42', amount: 100_000.5 },
      { affiliateId: '42', amount: -1 },
    ])
      await expect(svc.create(bad)).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.approve({ id: '999', approverId: '7', currentFullName: 'Sotuvchi' }),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      svc.reject({ id: '999', rejectedBy: '7', reason: '' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('BE-25: maqom bekor qilinsa yoki ism o‘zgarsa so‘rov tasdiqlanmaydi (pul shundan keyin o‘tkaziladi)', async () => {
    const approve = (id: string, currentFullName: string) =>
      svc.approve({ id, approverId: '7', currentFullName });
    await fund('78', 200_000);
    await selfEmployed('78');
    const { id } = await svc.create({ affiliateId: '78', amount: 100_000 });
    await expect(approve(id, 'Boshqa Ism')).rejects.toMatchObject({
      response: { errorCode: 'NAME_CHANGED' },
    });
    await selfEmployed('78', false);
    await expect(approve(id, 'Sotuvchi')).rejects.toMatchObject({
      status: 400,
    });
    // darvoza ochiq, lekin tasdiqlangan qator yo‘q (eski versiya qo‘ygan) — ham yo‘q
    await ds.query(
      `UPDATE finance.affiliate_payout_profile SET self_employed = true WHERE affiliate_id = '78'`,
    );
    await expect(approve(id, 'Sotuvchi')).rejects.toMatchObject({
      status: 400,
    });
    await selfEmployed('78');
    await approve(id, ' Sotuvchi ');
    expect((await svc.one({ id })).status).toBe(WithdrawalStatus.APPROVED);
    await expectBalanced();
  });

  it('BE-25: bekor qilish va «To‘landi» bir vaqtda — bekor qilingandan keyin to‘lov o‘tmaydi', async () => {
    await fund('77', 200_000);
    await selfEmployed('77');
    const { id } = await svc.create({ affiliateId: '77', amount: 100_000 });
    await svc.approve({ id, approverId: '7', currentFullName: 'Sotuvchi' });
    const holder = new Client({ connectionString: url });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query(
      `SELECT pg_advisory_xact_lock(2303, hashtext('finance-withdrawal:77'))`,
    );
    const revoked = selfEmployed('77', false);
    await new Promise((r) => setTimeout(r, 150));
    const paid = svc
      .markPaid({ id, paidBy: '8' })
      .then(() => 'to‘landi')
      .catch((e: { status?: number }) => e.status);
    await new Promise((r) => setTimeout(r, 150));
    await holder.query('COMMIT');
    await holder.end();
    await revoked;
    expect(await paid).toBe(400);
    await expectBalanced();
  });
});
