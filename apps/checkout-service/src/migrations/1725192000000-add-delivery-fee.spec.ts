import { AddDeliveryFee1725192000000 } from './1725192000000-add-delivery-fee';

describe('AddDeliveryFee1725192000000', () => {
  it('order va seller orderga delivery_fee qo‘shadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddDeliveryFee1725192000000();
    await migration.up({ query } as never);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('sales_order');
    expect(query.mock.calls[1][0]).toContain('sales_order_seller');
    expect(query.mock.calls[0][0]).toContain('delivery_fee');
  });
});
