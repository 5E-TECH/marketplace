import { CreateCodReconciliation1724932800000 } from './1724932800000-create-cod-reconciliation';

describe('CreateCodReconciliation1724932800000', () => {
  it('COD recon jadvali va ledger turlarini yaratadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreateCodReconciliation1724932800000().up({ query } as never);
    const sql = query.mock.calls.map(([value]) => value).join('\n');
    expect(sql).toContain('finance.cod_reconciliation');
    expect(sql).toContain('COD_SALE');
    expect(sql).toContain('COD_SETTLEMENT');
    expect(sql).toContain('netted_amount');
  });
});
