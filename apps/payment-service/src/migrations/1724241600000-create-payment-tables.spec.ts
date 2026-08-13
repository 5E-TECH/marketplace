import { CreatePaymentTables1724241600000 } from './1724241600000-create-payment-tables';

describe('CreatePaymentTables1724241600000', () => {
  it('payment, transaction va provider_config jadvallarini yaratadi', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => queries.push(sql)),
    };
    await new CreatePaymentTables1724241600000().up(runner as never);
    const sql = queries.join('\n');
    expect(sql).toContain('"payment"."payment"');
    expect(sql).toContain('"payment"."payment_transaction"');
    expect(sql).toContain('"payment"."provider_config"');
    expect(sql).toContain('"secret_encrypted" TEXT');
  });
});
