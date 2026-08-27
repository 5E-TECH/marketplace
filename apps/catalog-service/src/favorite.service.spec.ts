import { BadRequestException } from '@nestjs/common';
import { FavoriteService } from './favorite.service';

describe('FavoriteService guest favorites', () => {
  function setup() {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return [];
      }),
    };
    const favorites = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: '1', ...value })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      exists: jest.fn().mockResolvedValue(true),
      manager: {
        transaction: jest.fn(async (run) => run(manager)),
      },
    };
    const productBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: '85' }),
    };
    const products = {
      createQueryBuilder: jest.fn(() => productBuilder),
    };
    return {
      service: new FavoriteService(favorites as never, products as never),
      favorites,
      queries,
    };
  }

  it('guest session egasi bilan favorite qo‘shadi', async () => {
    const { service, favorites } = setup();

    await expect(
      service.add({ sessionId: 'guest-uuid' }, '85'),
    ).resolves.toEqual({ productId: '85', isFavorite: true });
    expect(favorites.save).toHaveBeenCalledWith({
      sessionId: 'guest-uuid',
      productId: '85',
    });
  });

  it('egasiz so‘rovni rad etadi', async () => {
    const { service } = setup();
    await expect(service.add({}, '85')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('guest favorite’larni userga idempotent merge qiladi', async () => {
    const { service, queries } = setup();

    await expect(service.merge('42', 'guest-uuid')).resolves.toEqual({
      merged: true,
    });
    expect(queries).toHaveLength(2);
    expect(queries[0].sql).toContain('ON CONFLICT');
    expect(queries[0].params).toEqual(['42', 'guest-uuid']);
    expect(queries[1].sql).toContain('DELETE FROM catalog.favorite');
  });
});
