import { CreatePaymentRefund1727481600000 } from './1727481600000-create-payment-refund';

describe('CreatePaymentRefund1727481600000', () => {
  it('qisman refund jadvalini unikal idempotency kaliti bilan yaratadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreatePaymentRefund1727481600000().up({ query } as never);
    const sql = query.mock.calls.map(([value]) => value).join('\n');
    expect(sql).toContain('payment.payment_refund');
    expect(sql).toContain('idempotency_key VARCHAR(255) NOT NULL UNIQUE');
    expect(sql).toContain('CHECK (amount > 0)');
  });
});
