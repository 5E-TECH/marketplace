import {
  CommissionType,
  FinanceLedgerEntryType,
  FinancePayoutStatus,
} from '@app/common';
import { FinanceService } from './finance.service';

describe('FinanceService (C3.5)', () => {
  function setup(commission = { type: CommissionType.PERCENT, value: 10 }) {
    const ledgers: any[] = [];
    const payouts: any[] = [];
    const reconciliations: any[] = [];
    let nextLedgerId = 1;
    let nextPayoutId = 1;

    const query = jest.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (
        sql.includes('FROM finance.cod_reconciliation WHERE seller_order_id')
      ) {
        const row = reconciliations.find(
          (item) => item.sellerOrderId === params[0],
        );
        return row
          ? [
              {
                commission: row.commissionAmount,
                difference: row.collectedAmount - row.expectedAmount,
              },
            ]
          : [];
      }
      if (
        sql.includes('FROM finance.payout WHERE reference_id=$1 FOR UPDATE')
      ) {
        const row = payouts.find((item) => item.referenceId === params[0]);
        return row ? [row] : [];
      }
      if (sql.includes('FROM finance.payout WHERE id=$1')) {
        const row = payouts.find((item) => item.id === String(params[0]));
        return row ? [row] : [];
      }
      if (sql.includes('SELECT balance_after::float8 AS balance')) {
        const rows = ledgers.filter((item) => item.shopId === params[0]);
        return rows.length ? [{ balance: rows.at(-1).balanceAfter }] : [];
      }
      if (sql.includes('FROM finance.commission') && sql.includes('LIMIT 1')) {
        return commission ? [commission] : [];
      }
      if (sql.includes('INSERT INTO finance.seller_ledger')) {
        const row = {
          id: String(nextLedgerId++),
          shopId: params[0],
          entryType: params[1],
          amount: Number(params[2]),
          balanceAfter: Number(params[3]),
          referenceType: params[4],
          referenceId: params[5],
          createdAt: new Date(),
        };
        ledgers.push(row);
        return [row];
      }
      if (sql.includes('INSERT INTO finance.payout')) {
        const row = {
          id: String(nextPayoutId++),
          shopId: params[0],
          amount: Number(params[1]),
          status: params[2],
          method: params[3],
          referenceId: params[4],
          paidAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        payouts.push(row);
        return [row];
      }
      if (sql.includes('INSERT INTO finance.cod_reconciliation')) {
        reconciliations.push({
          eventId: params[0],
          sellerOrderId: params[1],
          salesOrderId: params[2],
          shopId: params[3],
          expectedAmount: Number(params[4]),
          collectedAmount: Number(params[5]),
          commissionAmount: Number(params[6]),
          nettedAmount: 0,
        });
        return [];
      }
      if (sql.includes('WITH debts AS')) {
        let remaining = Number(params[1]);
        for (const row of reconciliations.filter(
          (item) => item.shopId === params[0],
        )) {
          const outstanding = row.commissionAmount - row.nettedAmount;
          const allocated = Math.min(outstanding, remaining);
          row.nettedAmount += allocated;
          remaining -= allocated;
          if (remaining <= 0) break;
        }
        return [];
      }
      if (sql.includes('AS "settlementsCount"')) {
        return [
          {
            settlementsCount: reconciliations.length,
            expectedCodAmount: reconciliations.reduce(
              (sum, row) => sum + row.expectedAmount,
              0,
            ),
            collectedCodAmount: reconciliations.reduce(
              (sum, row) => sum + row.collectedAmount,
              0,
            ),
            difference: reconciliations.reduce(
              (sum, row) => sum + row.collectedAmount - row.expectedAmount,
              0,
            ),
            expectedCommission: reconciliations.reduce(
              (sum, row) => sum + row.commissionAmount,
              0,
            ),
            nettedCommission: reconciliations.reduce(
              (sum, row) => sum + row.nettedAmount,
              0,
            ),
            outstandingCommission: reconciliations.reduce(
              (sum, row) => sum + row.commissionAmount - row.nettedAmount,
              0,
            ),
          },
        ];
      }
      if (
        sql.includes('FROM finance.seller_ledger') &&
        sql.includes("reference_type='seller_order_refund'")
      ) {
        const row = ledgers.find(
          (item) =>
            item.shopId === params[0] &&
            item.entryType === FinanceLedgerEntryType.REFUND &&
            item.referenceId === params[2],
        );
        return row ? [row] : [];
      }
      if (
        sql.includes('FROM finance.seller_ledger') &&
        sql.includes("entry_type IN ('SALE','COMMISSION')")
      ) {
        return ledgers
          .filter(
            (item) =>
              item.shopId === params[0] &&
              item.referenceType === 'seller_order' &&
              item.referenceId === params[1],
          )
          .map((item) => ({
            entryType: item.entryType,
            amount: item.amount,
          }));
      }
      if (sql.includes("SET status='HELD'")) {
        const row = payouts.find((item) => item.referenceId === params[0]);
        if (row && row.status !== FinancePayoutStatus.PAID) {
          row.status = FinancePayoutStatus.HELD;
        }
        return [];
      }
      if (sql.includes("SET status='PAID'")) {
        const row = payouts.find((item) => item.id === String(params[0]));
        row.status = FinancePayoutStatus.PAID;
        row.paidAt = new Date();
        return [row];
      }
      if (sql.includes('UPDATE finance.payout SET status=$2')) {
        const row = payouts.find((item) => item.id === String(params[0]));
        if (!row || row.status === FinancePayoutStatus.PAID) return [];
        row.status = params[1];
        return [row];
      }
      return [];
    });
    const manager = { query };
    const dataSource = {
      manager,
      query,
      transaction: jest.fn(async (run) => run(manager)),
    };
    return {
      service: new FinanceService(dataSource as never),
      ledgers,
      payouts,
      reconciliations,
      query,
    };
  }

  const delivered = {
    eventId: 'delivered-1',
    sellerOrderId: '55',
    salesOrderId: '10',
    shopId: '7',
    amount: 1000,
    paymentMethod: 'online',
    occurredAt: new Date().toISOString(),
  };

  it('TC1/TC2: delivered sale va 10% commission yozib balans/payoutni hisoblaydi', async () => {
    const { service, ledgers, payouts } = setup();

    await expect(
      service.processPayoutRequested(delivered),
    ).resolves.toMatchObject({
      balance: 900,
      payout: { amount: 900, status: 'PENDING' },
    });
    expect(
      ledgers.map(({ entryType, amount, balanceAfter }) => ({
        entryType,
        amount,
        balanceAfter,
      })),
    ).toEqual([
      { entryType: 'SALE', amount: 1000, balanceAfter: 1000 },
      { entryType: 'COMMISSION', amount: -100, balanceAfter: 900 },
    ]);
    expect(payouts).toHaveLength(1);
  });

  it('TC2: FIXED komissiyani to‘g‘ri hisoblaydi', async () => {
    const { service, ledgers, payouts } = setup({
      type: CommissionType.FIXED,
      value: 125,
    });

    await service.processPayoutRequested(delivered);
    expect(ledgers[1]).toMatchObject({ amount: -125, balanceAfter: 875 });
    expect(payouts[0].amount).toBe(875);
  });

  it('TC3: event va payout release ikki marta bajarilmaydi', async () => {
    const { service, ledgers, payouts } = setup();

    await service.processPayoutRequested(delivered);
    await expect(
      service.processPayoutRequested(delivered),
    ).resolves.toMatchObject({
      idempotent: true,
    });
    expect(ledgers).toHaveLength(2);
    expect(payouts).toHaveLength(1);

    await service.approvePayout('1');
    await service.releasePayout('1');
    await service.releasePayout('1');
    expect(
      ledgers.filter((row) => row.entryType === FinanceLedgerEntryType.PAYOUT),
    ).toHaveLength(1);
    expect(payouts[0].status).toBe(FinancePayoutStatus.PAID);
  });

  it('TC4: refund ledgerga net savdoning teskari yozuvini qo‘shadi', async () => {
    const { service, ledgers, payouts } = setup();
    await service.processPayoutRequested(delivered);

    await expect(
      service.refund({
        eventId: 'refund-1',
        sellerOrderId: '55',
        shopId: '7',
        occurredAt: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({ balance: 0, entry: { amount: -900 } });
    expect(ledgers.at(-1)).toMatchObject({
      entryType: FinanceLedgerEntryType.REFUND,
      balanceAfter: 0,
    });
    expect(payouts[0].status).toBe(FinancePayoutStatus.HELD);
  });

  it('C4.3 TC1: COD settled sale, settlement va commission ledger yozadi', async () => {
    const { service, ledgers } = setup();
    await expect(
      service.processCodSettled({
        eventId: 'settled-1',
        sellerOrderId: '77',
        salesOrderId: '70',
        shopId: '7',
        expectedAmount: 1000,
        collectedAmount: 1000,
        occurredAt: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({
      balance: -100,
      commission: 100,
      difference: 0,
    });
    expect(ledgers.map((row) => [row.entryType, row.amount])).toEqual([
      [FinanceLedgerEntryType.COD_SALE, 1000],
      [FinanceLedgerEntryType.COD_SETTLEMENT, -1000],
      [FinanceLedgerEntryType.COMMISSION, -100],
    ]);
  });

  it('C4.3 TC2: COD komissiyani keyingi online payoutdan netting qiladi', async () => {
    const { service, payouts, reconciliations } = setup();
    await service.processCodSettled({
      eventId: 'settled-1',
      sellerOrderId: '77',
      salesOrderId: '70',
      shopId: '7',
      expectedAmount: 1000,
      collectedAmount: 1000,
      occurredAt: new Date().toISOString(),
    });
    await service.processPayoutRequested(delivered);
    expect(payouts[0].amount).toBe(800);
    expect(reconciliations[0].nettedAmount).toBe(100);
  });

  it('C4.3 TC3: recon hisobotda COD farqi 0', async () => {
    const { service } = setup();
    await service.processCodSettled({
      eventId: 'settled-1',
      sellerOrderId: '77',
      salesOrderId: '70',
      shopId: '7',
      expectedAmount: 1000,
      collectedAmount: 1000,
      occurredAt: new Date().toISOString(),
    });
    await expect(
      service.reconciliationReport({ shopId: '7' }),
    ).resolves.toMatchObject({
      settlementsCount: 1,
      expectedCodAmount: 1000,
      collectedCodAmount: 1000,
      difference: 0,
      expectedCommission: 100,
    });
  });
});
