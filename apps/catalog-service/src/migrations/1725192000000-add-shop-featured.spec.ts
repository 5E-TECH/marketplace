import { AddShopFeatured1725192000000 } from './1725192000000-add-shop-featured';

describe('AddShopFeatured1725192000000', () => {
  it('is_featured ustuni va active featured indeksini yaratadi/qaytaradi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddShopFeatured1725192000000();

    await migration.up({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('is_featured'));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('idx_catalog_shop_featured_active'),
    );

    query.mockClear();
    await migration.down({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DROP COLUMN'));
  });
});
