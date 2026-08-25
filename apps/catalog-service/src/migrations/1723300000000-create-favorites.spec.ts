import { CreateFavorites1723300000000 } from './1723300000000-create-favorites';

describe('CreateFavorites migration', () => {
  it('user-product unique bog‘lanishi va indeks yaratadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreateFavorites1723300000000().up({ query } as never);
    const sql = query.mock.calls.map(([value]) => value).join('\n');
    expect(sql).toContain('catalog.favorite');
    expect(sql).toContain('UNIQUE(user_id, product_id)');
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('idx_catalog_favorite_user_created');
  });
});
