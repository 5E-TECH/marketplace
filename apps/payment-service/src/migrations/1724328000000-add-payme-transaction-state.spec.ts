import { AddPaymeTransactionState1724328000000 } from './1724328000000-add-payme-transaction-state';

describe('AddPaymeTransactionState migration', () => {
  it('Payme state vaqtlarini va provider transaction unique indexini yaratadi', async () => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => queries.push(sql)) };
    await new AddPaymeTransactionState1724328000000().up(runner as never);
    const sql = queries.join('\n');
    expect(sql).toContain('"create_time" BIGINT');
    expect(sql).toContain('"perform_time" BIGINT');
    expect(sql).toContain('uq_payment_transaction_provider_txn');
  });
});
