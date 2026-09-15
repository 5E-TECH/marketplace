import { AddCartItemProductName1726416000000 } from './1726416000000-add-cart-item-product-name';

describe('AddCartItemProductName1726416000000', () => {
  it('cart_item ga product_name_snapshot ustunini qo‘shadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddCartItemProductName1726416000000();

    await migration.up({ query } as never);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('product_name_snapshot'),
    );
  });

  it('down ustunni olib tashlaydi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddCartItemProductName1726416000000().down({ query } as never);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DROP COLUMN IF EXISTS "product_name_snapshot"'),
    );
  });
});
