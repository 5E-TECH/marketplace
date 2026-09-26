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
    for (const m of [
      'list',
      'get',
      'label',
      'sellerOrderLabel',
      'labelsBatch',
    ] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, AdminOrdersController.prototype[m]),
      ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    }
  });

  it('C1.45 TC4/TC5: admin bitta va batch yorliqni checkoutdan oladi', async () => {
    const send = jest.fn(() =>
      of({
        fileName: 'shipments.pdf',
        contentType: 'application/pdf',
        base64: 'JVBERg==',
      }),
    );
    const ctrl = makeController(send);
    const res = { setHeader: jest.fn() };

    await ctrl.label('9', res as never);
    await ctrl.labelsBatch({ orderIds: ['9', '10'] }, res as never);
    await ctrl.sellerOrderLabel('14', '15', res as never);

    expect(send).toHaveBeenNthCalledWith(
      1,
      { cmd: 'checkout.admin.order-label' },
      { orderId: '9' },
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      { cmd: 'checkout.admin.order-labels' },
      { orderIds: ['9', '10'] },
    );
    // Bitta posilka: buyurtma id'si ham uzatiladi — posilka shu buyurtmaga
    // tegishliligi checkoutda tekshiriladi (id fazolari aralashmasin).
    expect(send).toHaveBeenNthCalledWith(
      3,
      { cmd: 'checkout.admin.seller-order-label' },
      { orderId: '14', sellerOrderId: '15' },
    );
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('C1.45: partiyada chiqmagan yorliqlar X-Labels-Skipped headerida', async () => {
    const skipped = [
      { orderId: '7', reason: 'Elchi shipment QR tokeni mavjud emas' },
    ];
    const send = jest.fn(() =>
      of({
        fileName: 'shipments-1.pdf',
        contentType: 'application/pdf',
        base64: 'JVBERg==',
        skipped,
      }),
    );
    const res = { setHeader: jest.fn() };

    await makeController(send).labelsBatch(
      { orderIds: ['9', '7'] },
      res as never,
    );

    const [name, value] = res.setHeader.mock.calls[0];
    expect(name).toBe('X-Labels-Skipped');
    // Header faqat ASCII bo'lishi shart — sabablar esa o'zbekcha.
    expect(value).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(decodeURIComponent(value))).toEqual(skipped);
  });

  it('C1.45: token backfill faqat SUPERADMIN, dryRun audit yozmaydi', async () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminOrdersController.prototype.syncShipmentTokens,
      ),
    ).toEqual([Role.SUPERADMIN]);
    const checkoutSend = jest.fn(() => of({ items: [], nextAfterId: null }));
    const identitySend = jest.fn(() => of({}));
    const controller = new AdminOrdersController(
      { send: checkoutSend } as never,
      { send: identitySend } as never,
    );
    const admin = { sub: '1', role: Role.SUPERADMIN } as never;

    await controller.syncShipmentTokens({ dryRun: true }, admin, '127.0.0.1');
    expect(identitySend).not.toHaveBeenCalled();

    await controller.syncShipmentTokens({ afterId: '6' }, admin, '127.0.0.1');
    expect(checkoutSend).toHaveBeenLastCalledWith(
      { cmd: 'checkout.admin.shipment-tokens-sync' },
      { afterId: '6' },
    );
    expect(identitySend).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'order.shipment-tokens-sync' }),
    );
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
