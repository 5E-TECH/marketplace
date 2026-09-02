import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminShopsController } from './admin-shops.controller';

function makeController(
  catalogSend: jest.Mock,
  identitySend: jest.Mock = jest.fn(() => of({})),
  inventorySend: jest.Mock = jest.fn(() => of({})),
  checkoutSend: jest.Mock = jest.fn(() => of(0)),
) {
  return new AdminShopsController(
    { send: catalogSend } as never,
    { send: identitySend } as never,
    { send: inventorySend } as never,
    { send: checkoutSend } as never,
  );
}

describe('AdminShopsController (C1.7)', () => {
  it('TC4: list/approve/reject faqat ADMIN va SUPERADMIN uchun (@Roles)', () => {
    for (const method of [
      'list',
      'detail',
      'approve',
      'reject',
      'suspend',
      'activate',
    ] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, AdminShopsController.prototype[method]),
      ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    }
  });

  it('C1.32 TC1: detail profil va uchta statistikani jamlaydi', async () => {
    const catalog = jest.fn(() =>
      of({ shop: { id: '9', name: 'Zamon', status: 'ACTIVE' }, products: 4 }),
    );
    const inventory = jest.fn(() => of(2));
    const checkout = jest.fn(() => of(7));
    const ctrl = makeController(
      catalog,
      jest.fn(() => of({})),
      inventory,
      checkout,
    );

    await expect(ctrl.detail('9')).resolves.toEqual({
      id: '9',
      name: 'Zamon',
      status: 'ACTIVE',
      stats: { products: 4, orders: 7, warehouses: 2 },
    });
  });

  it('C1.32: suspend/activate catalogga uzatiladi va audit yoziladi', async () => {
    const catalog = jest.fn(() => of({ id: '9', status: 'SUSPENDED' }));
    const identity = jest.fn(() => of({}));
    const ctrl = makeController(catalog, identity);

    await ctrl.suspend('9', { sub: '7', role: Role.ADMIN } as never, '1.2.3.4');
    await ctrl.activate(
      '9',
      { sub: '7', role: Role.ADMIN } as never,
      '1.2.3.4',
    );

    expect(catalog).toHaveBeenNthCalledWith(
      1,
      { cmd: 'catalog.shop.suspend' },
      { shopId: '9' },
    );
    expect(catalog).toHaveBeenNthCalledWith(
      2,
      { cmd: 'catalog.shop.activate' },
      { shopId: '9' },
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'shop.suspend', entityId: '9' }),
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'shop.activate', entityId: '9' }),
    );
  });

  it('TC1: list -> catalog.shop.admin-list ga query uzatiladi', async () => {
    const catalog = jest.fn(() => of({ items: [], total: 0 }));
    const ctrl = makeController(catalog);
    await ctrl.list({ status: undefined, page: 1, limit: 20 } as never);
    expect(catalog).toHaveBeenCalledWith(
      { cmd: 'catalog.shop.admin-list' },
      { query: { status: undefined, page: 1, limit: 20 } },
    );
  });

  it('TC2: approve -> catalog(approve) -> identity -> inventory -> catalog(publish-approved)', async () => {
    const catalog = jest.fn(() =>
      of({
        id: '9',
        ownerUserId: '42',
        name: 'Zamon',
        phone: '+998901234567',
        regionId: '1',
        districtId: '10',
      }),
    );
    const identity = jest.fn(() => of({}));
    const inventory = jest.fn(() => of({}));
    const ctrl = makeController(catalog, identity, inventory);

    const res: any = await ctrl.approve(
      '9',
      { sub: '7', role: Role.ADMIN } as never,
      '',
    );

    expect(catalog).toHaveBeenCalledWith(
      { cmd: 'catalog.shop.approve' },
      { shopId: '9' },
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.user.set-active' },
      { userId: '42', isActive: true },
    );
    expect(inventory).toHaveBeenCalledWith(
      { cmd: 'inventory.warehouse.ensure-default' },
      expect.objectContaining({ shopId: '9', regionId: '1', districtId: '10' }),
    );
    // EMIT OXIRIDA: shop.approved faqat user+ombor tayyor bo'lgach chiqadi
    expect(catalog).toHaveBeenNthCalledWith(
      2,
      { cmd: 'catalog.shop.publish-approved' },
      {
        sellerUserId: '42',
        shopId: '9',
        shopName: 'Zamon',
        phone: '+998901234567',
      },
    );
    // tartib: inventory (3-qadam) publish (4-qadam) dan OLDIN
    expect(inventory.mock.invocationCallOrder[0]).toBeLessThan(
      catalog.mock.invocationCallOrder[1],
    );
    expect(res.id).toBe('9');
  });

  it('TC3: reject -> catalog.shop.reject (reason bilan)', async () => {
    const catalog = jest.fn(() => of({ id: '9', status: 'REJECTED' }));
    const ctrl = makeController(catalog);
    await ctrl.reject(
      '9',
      { reason: 'sabab' } as never,
      undefined as never,
      '',
    );
    expect(catalog).toHaveBeenCalledWith(
      { cmd: 'catalog.shop.reject' },
      { shopId: '9', reason: 'sabab' },
    );
  });

  it('C1.31: approve -> identity.audit.log (actor, shop.approve, ip)', async () => {
    const catalog = jest.fn(() =>
      of({
        id: '9',
        ownerUserId: '42',
        name: 'Zamon',
        phone: '+998901234567',
        regionId: '1',
        districtId: '10',
      }),
    );
    const identity = jest.fn(() => of({}));
    const ctrl = makeController(catalog, identity);

    await ctrl.approve('9', { sub: '7', role: Role.ADMIN } as never, '1.2.3.4');

    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      {
        actorId: '7',
        action: 'shop.approve',
        entityType: 'Shop',
        entityId: '9',
        meta: { ip: '1.2.3.4' },
      },
    );
  });
});
