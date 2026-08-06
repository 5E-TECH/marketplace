import { CreateCartTables1723032000000 } from './1723032000000-create-cart-tables';

describe('CreateCartTables1723032000000', () => {
  it('cart, cart_item va active owner unique indekslarini yaratadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreateCartTables1723032000000().up({ query } as never);
    const sql = query.mock.calls.map(([value]) => value).join('\n');
    expect(sql).toContain('"checkout"."cart"');
    expect(sql).toContain('"checkout"."cart_item"');
    expect(sql).toContain('uq_checkout_active_cart_customer');
    expect(sql).toContain('uq_checkout_active_cart_session');
    expect(sql).toContain('unit_price_snapshot');
  });
});
