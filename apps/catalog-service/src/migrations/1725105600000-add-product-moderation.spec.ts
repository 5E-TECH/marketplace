import { AddProductModeration1725105600000 } from './1725105600000-add-product-moderation';

describe('AddProductModeration1725105600000', () => {
  it('is_blocked ustuni va indeksini yaratadi/qaytaradi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddProductModeration1725105600000();

    await migration.up({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('is_blocked'));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('idx_catalog_product_is_blocked'),
    );

    query.mockClear();
    await migration.down({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DROP COLUMN'));
  });
});
