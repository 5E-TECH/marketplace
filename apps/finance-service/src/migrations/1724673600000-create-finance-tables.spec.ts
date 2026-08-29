import { CreateFinanceTables1724673600000 } from './1724673600000-create-finance-tables';

describe('CreateFinanceTables1724673600000', () => {
  it('ledger, payout va commission jadvallarini idempotency indekslari bilan yaratadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreateFinanceTables1724673600000().up({ query } as never);
    const sql = query.mock.calls.map(([value]) => value).join('\n');

    expect(sql).toContain('"finance"."seller_ledger"');
    expect(sql).toContain('"finance"."payout"');
    expect(sql).toContain('"finance"."commission"');
    expect(sql).toContain('uq_finance_ledger_reference');
    expect(sql).toContain('uq_finance_commission_global');
  });
});
