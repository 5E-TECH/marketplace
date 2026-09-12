import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminOrdersController } from './admin-orders.controller';

function makeController(send: jest.Mock) {
  return new AdminOrdersController(
    { send } as never,
    { send: jest.fn(() => of({})) } as never,
  );
}

describe('AdminOrdersController (C1.30/C6.4)', () => {
  it('TC4: list/get faqat ADMIN/SUPERADMIN (@Roles)', () => {
    for (const m of ['list', 'get'] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, AdminOrdersController.prototype[m]),
      ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    }
  });

  it('C6.4: cancel ADMIN/SUPERADMIN, refund faqat SUPERADMIN', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminOrdersController.prototype.cancel),
    ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminOrdersController.prototype.refund),
    ).toEqual([Role.SUPERADMIN]);
  });

  it('C6.4: refund checkoutga uzatiladi va audit yoziladi', async () => {
    const checkoutSend = jest.fn(() => of({ id: '12', status: 'REFUNDED' }));
    const identitySend = jest.fn(() => of({ id: 'audit-1' }));
    const controller = new AdminOrdersController(
      { send: checkoutSend } as never,
      { send: identitySend } as never,
    );

    await expect(
      controller.refund(
        '12',
        { reason: 'Tovar yo‘q' },
        { sub: '1', role: Role.SUPERADMIN } as never,
        '127.0.0.1',
      ),
    ).resolves.toMatchObject({ status: 'REFUNDED' });
    expect(checkoutSend).toHaveBeenCalledWith(
      { cmd: 'checkout.admin.order-refund' },
      expect.objectContaining({ orderId: '12', actorId: '1' }),
    );
    expect(identitySend).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'order.refund', entityId: '12' }),
    );
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
