import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { FraudFeeEvent } from '@app/common';
import { CreateFinanceTables1724673600000 } from '../migrations/1724673600000-create-finance-tables';
import { CreateCodReconciliation1724932800000 } from '../migrations/1724932800000-create-cod-reconciliation';
import { CreatePayoutSchedule1727568000000 } from '../migrations/1727568000000-create-payout-schedule';
import { CreateLedger1795478400000 } from '../migrations/1795478400000-create-ledger';
import { AddJournalLeadIndex1795564800000 } from '../migrations/1795564800000-add-journal-lead-index';
import { CreateWithdrawal1795651200000 } from '../migrations/1795651200000-create-withdrawal';
import { CreateWholesalerSettlement1795737600000 } from '../migrations/1795737600000-create-wholesaler-settlement';
import { CreateFeeHold1795824000000 } from '../migrations/1795824000000-create-fee-hold';
import { BalanceCheckService } from './balance-check.service';
import { LedgerService } from './ledger.service';
import { orderEvent } from './order-events.samples';

const url = process.env.FINANCE_TEST_DATABASE_URL;
const describePostgres = url ? describe : describe.skip;

/**
 * BE-35 — firibgarlik markazi sotuvchi haqini ushlaydi (TZ 7). Lid 9001, sotuvchi A (order-events.samples).
 * Har test oxirida kechki balans tekshiruvi.
 */
describePostgres('BE-35 sotuvchi haqini ushlash (PostgreSQL)', () => {
  let ds: DataSource;
  let ledger: LedgerService;
  let check: BalanceCheckService;
  let seq = 0;

  const deliver = () => ledger.onOrderStatusChanged(orderEvent());
  const remit = () =>
    ledger.onRemittance({
      schemaVersion: 2,
      eventId: 'rem-501',
      orderId: '501',
      shipmentId: '1251131',
      elchiStatus: 'paid',
      collectedFromCustomer: 291000,
      elchiFee: 40000,
      marketPaidAmount: 251000,
      occurredAt: '2026-12-21T10:00:00.000Z',
    });
  const fee = (
    kind: 'HELD' | 'RELEASED' | 'CANCELLED',
    over: Partial<FraudFeeEvent> = {},
  ) => {
    const event: FraudFeeEvent = {
      eventId: `fee-${++seq}`,
      incidentId: '12',
      affiliateId: 'A',
      leadIds: ['9001'],
      reason: 'test',
      at: '2026-12-22T10:00:00.000Z',
      ...over,
    };
    return ledger.onFeeHold(event, kind);
  };
  const affiliate = async () => {
    const [row] = (await ds.query(
      `SELECT hold_balance::int AS hold, available_balance::int AS available
         FROM finance.account WHERE type = 'AFFILIATE' AND owner_id = 'A'`,
    )) as Array<{ hold: number; available: number }>;
    return row ?? { hold: 0, available: 0 };
  };
  const otherHold = async () =>
    Number(
      (
        await ds.query(
          `SELECT COALESCE(SUM(e.amount), 0)::int AS n FROM finance.ledger_entry e
             JOIN finance.account a ON a.id = e.account_id
            WHERE e.state = 'HOLD' AND a.type <> 'AFFILIATE'`,
        )
      )[0].n,
    );
  const status = async () =>
    (
      (await ds.query(
        `SELECT status FROM finance.fee_hold WHERE lead_id = '9001'`,
      )) as Array<{ status: string }>
    )[0]?.status;
  const expectBalanced = async () => {
    const result = await check.run();
    expect(result.details.unbalancedJournals).toEqual([]);
    expect(result.details.accounts).toEqual([]);
    expect(result.ok).toBe(true);
  };

  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_finance_test'))
      throw new Error(
        'FINANCE_TEST_DATABASE_URL nomi _finance_test bilan tugashi kerak',
      );
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
      finance.elchi_remittance, finance.balance_check, finance.processed_event, finance.event_failure,
      finance.fee_hold`);
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

  it('ushlangan haq Elchi o‘tkazmasidan keyin ham HOLD da; qo‘yib yuborilsa — shu zahoti AVAILABLE; takror hodisa — bir marta', async () => {
    await deliver();
    const { hold: feeAmount } = await affiliate();
    expect(feeAmount).toBeGreaterThan(0);
    await fee('HELD');
    await remit();
    expect(await affiliate()).toEqual({ hold: feeAmount, available: 0 });
    expect(await otherHold()).toBe(0); // boshqa tomonlar odatdagidek
    await expectBalanced();

    const release: FraudFeeEvent = {
      eventId: 'rel-1',
      incidentId: '12',
      affiliateId: 'A',
      leadIds: ['9001'],
      reason: 'asossiz',
      at: '2026-12-23T10:00:00.000Z',
    };
    await ledger.onFeeHold(release, 'RELEASED');
    await ledger.onFeeHold(release, 'RELEASED');
    expect(await status()).toBe('RELEASED');
    expect(await affiliate()).toEqual({ hold: 0, available: feeAmount });
    await expectBalanced();
  });

  it('o‘tkazmadan oldin qo‘yib yuborilsa — o‘tkazma kelganda odatdagidek AVAILABLE', async () => {
    await deliver();
    const { hold: feeAmount } = await affiliate();
    await fee('HELD');
    await fee('RELEASED');
    expect(await affiliate()).toEqual({ hold: feeAmount, available: 0 });
    await remit();
    expect(await affiliate()).toEqual({ hold: 0, available: feeAmount });
    await expectBalanced();
  });

  it('bekor qilish yakuniy: haq sotuvchiga o‘tmaydi, keyingi qo‘yib yuborish va ushlash o‘zgartirmaydi; qaytarish ishlaydi', async () => {
    await fee('HELD'); // yetkazilishdan oldin
    await deliver();
    const { hold: feeAmount } = await affiliate();
    await fee('CANCELLED');
    await remit();
    await fee('RELEASED');
    await fee('HELD');
    expect(await status()).toBe('CANCELLED');
    expect(await affiliate()).toEqual({ hold: feeAmount, available: 0 });
    await expectBalanced();
    await ledger.onOrderReturned({
      eventId: 'ret-501',
      orderId: '501',
      returnRequestId: 'RR-501',
      items: [{ productId: '88', quantity: 1 }],
      occurredAt: '2026-12-25T10:00:00.000Z',
    });
    expect(await affiliate()).toEqual({ hold: 0, available: 0 });
    await expectBalanced();
  });

  it('kech kelgan ushlash mavjud haqqa tegmaydi; noto‘g‘ri hodisa — event_failure', async () => {
    await deliver();
    const { hold: feeAmount } = await affiliate();
    await remit();
    await fee('HELD');
    expect(await status()).toBe('HELD');
    expect(await affiliate()).toEqual({ hold: 0, available: feeAmount });
    await fee('HELD', { leadIds: [] });
    expect(
      Number(
        (await ds.query(`SELECT count(*) AS n FROM finance.event_failure`))[0]
          .n,
      ),
    ).toBe(1);
    await expectBalanced();
  });
});
