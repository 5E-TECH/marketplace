import { AddSalesOrderSessionId1726329600000 } from './1726329600000-add-sales-order-session-id';

describe('AddSalesOrderSessionId1726329600000', () => {
  it('guest ownership uchun sales_order session_id ustunini qo‘shadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddSalesOrderSessionId1726329600000();

    await migration.up({ query } as never);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('session_id'));
  });
});
