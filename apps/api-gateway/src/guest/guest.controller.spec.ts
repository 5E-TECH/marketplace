import { of } from 'rxjs';
import { GuestController } from './guest.controller';

describe('GuestController', () => {
  it('guest savat va favoritesni birga merge qiladi', async () => {
    const checkout = { send: jest.fn(() => of({ items: [] })) };
    const catalog = { send: jest.fn(() => of({ merged: true })) };
    const controller = new GuestController(checkout as never, catalog as never);

    await expect(
      controller.merge({ sub: '42', role: 'BUYER' } as never, 'guest-uuid'),
    ).resolves.toEqual({ cart: { items: [] }, favorites: { merged: true } });
    expect(checkout.send).toHaveBeenCalledWith(
      { cmd: 'cart.merge' },
      { customerId: '42', sessionId: 'guest-uuid' },
    );
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'favorite.merge' },
      { userId: '42', sessionId: 'guest-uuid' },
    );
  });
});
