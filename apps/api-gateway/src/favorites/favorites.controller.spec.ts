import { of } from 'rxjs';
import { FavoritesController } from './favorites.controller';

describe('FavoritesController', () => {
  const catalog = { send: jest.fn() };
  const controller = new FavoritesController(catalog as never);
  const user = { sub: '42', role: 'BUYER' } as never;

  beforeEach(() => catalog.send.mockReset());

  it('token userId va productId bilan favorite qo‘shadi', async () => {
    catalog.send.mockReturnValue(of({ productId: '85', isFavorite: true }));
    await expect(controller.add(user, undefined, '85')).resolves.toEqual({
      productId: '85',
      isFavorite: true,
    });
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'favorite.add' },
      { owner: { userId: '42' }, productId: '85' },
    );
  });

  it('faqat joriy user favorites ro‘yxatini so‘raydi', async () => {
    const page = { items: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    catalog.send.mockReturnValue(of(page));
    await expect(
      controller.list(user, undefined, { page: 1, limit: 20 }),
    ).resolves.toEqual(page);
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'favorite.list' },
      { owner: { userId: '42' }, query: { page: 1, limit: 20 } },
    );
  });

  it('guest session bilan favorite qo‘shadi', async () => {
    catalog.send.mockReturnValue(of({ productId: '85', isFavorite: true }));
    await controller.add(undefined, 'guest-uuid', '85');
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'favorite.add' },
      { owner: { sessionId: 'guest-uuid' }, productId: '85' },
    );
  });
});
