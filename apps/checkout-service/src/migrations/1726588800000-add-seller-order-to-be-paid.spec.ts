import { AddSellerOrderToBePaid1726588800000 } from './1726588800000-add-seller-order-to-be-paid';

describe('AddSellerOrderToBePaid1726588800000', () => {
  it('sales_order_seller ga elchi_to_be_paid ustunini qo‘shadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddSellerOrderToBePaid1726588800000().up({ query } as never);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ADD COLUMN IF NOT EXISTS "elchi_to_be_paid"'),
    );
  });

  it('down ustunni olib tashlaydi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddSellerOrderToBePaid1726588800000().down({ query } as never);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DROP COLUMN IF EXISTS "elchi_to_be_paid"'),
    );
  });
});
