import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminOrdersController } from './admin-orders.controller';

function makeController(send: jest.Mock) {
  return new AdminOrdersController({ send } as never);
}

describe('AdminOrdersController (C1.30)', () => {
  it('TC4: list/get faqat ADMIN/SUPERADMIN (@Roles)', () => {
    for (const m of ['list', 'get'] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, AdminOrdersController.prototype[m]),
      ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    }
  });

  it('TC2: list -> checkout.admin.orders-list ga query uzatiladi', async () => {
    const send = jest.fn(() => of({ items: [], total: 0 }));
    const ctrl = makeController(send);
    await ctrl.list({
      status: 'CONFIRMED',
      shopId: '15',
      page: 1,
      limit: 20,
    } as never);
    expect(send).toHaveBeenCalledWith(
      { cmd: 'checkout.admin.orders-list' },
      { query: { status: 'CONFIRMED', shopId: '15', page: 1, limit: 20 } },
    );
  });

  it('TC3: get -> checkout.admin.order-get ga orderId', async () => {
    const send = jest.fn(() => of({ id: '12' }));
    const ctrl = makeController(send);
    await ctrl.get('12');
    expect(send).toHaveBeenCalledWith(
      { cmd: 'checkout.admin.order-get' },
      { orderId: '12' },
    );
  });
});
