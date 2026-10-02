import { ConflictException, NotFoundException } from '@nestjs/common';
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
        sql.includes('FROM finance.seller_ledger') &&
        sql.includes("reference_type='return_request'")
      ) {
        const row = ledgers.find(
          (item) =>
            item.shopId === params[0] &&
            item.entryType === FinanceLedgerEntryType.REFUND &&
            item.referenceType === 'return_request' &&
            item.referenceId === params[2],
        );
        return row ? [row] : [];
      }
      if (sql.includes("reference_type='cod_seller_order' AND entry_type IN")) {
        return ledgers
          .filter(
            (item) =>
              item.shopId === params[0] &&
              item.referenceId === params[1] &&
              ((item.referenceType === 'seller_order' &&
                ['SALE', 'COMMISSION'].includes(item.entryType)) ||
                (item.referenceType === 'cod_seller_order' &&
                  ['COD_SALE', 'COMMISSION'].includes(item.entryType))),
          )
          .map((item) => ({ entryType: item.entryType, amount: item.amount }));
      }
      if (sql.includes('SET amount=GREATEST(0,amount-$2)')) {
        const row = payouts.find(
          (item) =>
            item.referenceId === params[0] &&
            ['PENDING', 'APPROVED'].includes(item.status),
        );
        if (row) row.amount = Math.max(0, row.amount - Number(params[1]));
        return [];
      }
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

  it('C6.4: sellerga hali tushum yozilmagan bo‘lsa refund ledger no-op bo‘ladi', async () => {
    const { service, ledgers } = setup();
    await expect(
      service.refund({
        eventId: 'admin-refund-early',
        sellerOrderId: '55',
        shopId: '7',
        occurredAt: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({ entry: null, skipped: true, idempotent: true });
    expect(ledgers).toHaveLength(0);
  });

  describe('C4.2 qaytarish bo‘yicha qisman refund', () => {
    const returnRefund = (amount: number, sellerOrderId = '55') => ({
      eventId: 'return-refund:3',
      sellerOrderId,
      shopId: '7',
      occurredAt: new Date().toISOString(),
      amount,
      returnRequestId: '3',
    });

    it('online: summa minus komissiya ulushi yechiladi, pending payout kamayadi', async () => {
      const { service, ledgers, payouts } = setup();
      await service.processPayoutRequested(delivered);

      await expect(service.refund(returnRefund(300))).resolves.toMatchObject({
        balance: 630,
        idempotent: false,
        entry: { amount: -270, referenceType: 'return_request' },
      });
      expect(payouts[0]).toMatchObject({ amount: 630, status: 'PENDING' });

      await expect(service.refund(returnRefund(300))).resolves.toMatchObject({
        idempotent: true,
      });
      expect(
        ledgers.filter(
          (row) => row.entryType === FinanceLedgerEntryType.REFUND,
        ),
      ).toHaveLength(1);
    });

    it('COD: sotuvchida turgan naqd pul uchun qarz yoziladi (netting)', async () => {
      const { service, ledgers } = setup();
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
        service.refund(returnRefund(400, '77')),
      ).resolves.toMatchObject({ balance: -460, entry: { amount: -360 } });
      expect(ledgers.at(-1)).toMatchObject({
        entryType: FinanceLedgerEntryType.REFUND,
        referenceId: '3',
      });
    });

    it('sotuv hali ledgerda bo‘lmasa komissiya joriy qoida bilan hisoblanadi', async () => {
      const { service } = setup();
      await expect(service.refund(returnRefund(200))).resolves.toMatchObject({
        balance: -180,
        entry: { amount: -180 },
      });
    });

    it('noto‘g‘ri summa rad etiladi', async () => {
      const { service } = setup();
      // Mavjud validatsiya kabi sinxron otiladi (RMQ handler ikkalasini ushlaydi).
      expect(() => service.refund(returnRefund(0))).toThrow('Refund summasi');
    });
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

  it('ledger davr bo‘yicha filtrlanadi, dateTo kuni ham kiradi', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) =>
      sql.includes('COUNT(*)') ? [{ total: 11 }] : [],
    );
    const service = new FinanceService({ query } as never);

    await expect(
      service.listLedger({
        shopId: '7',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        page: 2,
        limit: 10,
      }),
    ).resolves.toMatchObject({ total: 11, page: 2, totalPages: 2 });

    const [countSql, countParams] = query.mock.calls[0];
    expect(countSql).toContain(
      `WHERE shop_id=$1 AND created_at >= $2 AND created_at < ($3::date + INTERVAL '1 day')`,
    );
    expect(countParams).toEqual(['7', '2026-09-01', '2026-09-30']);
    expect(query.mock.calls[1][1]).toEqual([
      '7',
      '2026-09-01',
      '2026-09-30',
      10,
      10,
    ]);
  });

  it('UPDATE ... RETURNING drayver shaklida: topilmasa 404, to‘langan bo‘lsa 409', async () => {
    // TypeORM postgres UPDATE uchun [qatorlar, soni] qaytaradi.
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('UPDATE finance.payout SET status=$2')) return [[], 0];
      if (sql.includes('UPDATE finance.commission')) return [[], 0];
      if (sql.includes('FROM finance.payout WHERE id=$1'))
        return params[0] === '7' ? [{ id: '7', status: 'PAID' }] : [];
      return [];
    });
    const service = new FinanceService({
      query,
      manager: { query },
      transaction: async (run: (m: unknown) => unknown) => run({ query }),
    } as never);

    await expect(service.approvePayout('7')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.holdPayout('8')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.updateCommission('9', { value: 5 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('release va komissiya tahriri massiv emas, bitta obyekt qaytaradi', async () => {
    const payout = { id: '7', shopId: '1', amount: 100, status: 'APPROVED' };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('FROM finance.payout WHERE id=$1')) return [payout];
      if (sql.includes('SELECT balance_after')) return [{ balance: 500 }];
      if (sql.includes('INSERT INTO finance.seller_ledger'))
        return [{ id: '1' }];
      if (sql.includes("SET status='PAID'"))
        return [[{ ...payout, status: 'PAID' }], 1];
      if (sql.includes('UPDATE finance.commission'))
        return [[{ id: '3', value: 12 }], 1];
      return [];
    });
    const service = new FinanceService({
      query,
      manager: { query },
      transaction: async (run: (m: unknown) => unknown) => run({ query }),
    } as never);

    await expect(service.releasePayout('7')).resolves.toEqual({
      ...payout,
      status: 'PAID',
    });
    await expect(service.updateCommission('3', { value: 12 })).resolves.toEqual(
      { id: '3', value: 12 },
    );
  });
});
