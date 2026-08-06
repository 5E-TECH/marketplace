import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminShopsController } from './admin-shops.controller';

function makeController(
  catalogSend: jest.Mock,
  identitySend: jest.Mock = jest.fn(() => of({})),
  inventorySend: jest.Mock = jest.fn(() => of({})),
) {
  return new AdminShopsController(
    { send: catalogSend } as never,
    { send: identitySend } as never,
    { send: inventorySend } as never,
  );
}

describe('AdminShopsController (C1.7)', () => {
  it('TC4: list/approve/reject faqat ADMIN va SUPERADMIN uchun (@Roles)', () => {
    for (const method of ['list', 'approve', 'reject'] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, AdminShopsController.prototype[method]),
      ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    }
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

  it('TC2: approve -> catalog(approve) -> identity(set-active) -> inventory(ensure-default)', async () => {
    const catalog = jest.fn(() =>
      of({
        id: '9',
        ownerUserId: '42',
        name: 'Zamon',
        regionId: '1',
        districtId: '10',
      }),
    );
    const identity = jest.fn(() => of({}));
    const inventory = jest.fn(() => of({}));
    const ctrl = makeController(catalog, identity, inventory);

    const res: any = await ctrl.approve('9');

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
    expect(res.id).toBe('9');
  });

  it('TC3: reject -> catalog.shop.reject (reason bilan)', async () => {
    const catalog = jest.fn(() => of({ id: '9', status: 'REJECTED' }));
    const ctrl = makeController(catalog);
    await ctrl.reject('9', { reason: 'sabab' } as never);
    expect(catalog).toHaveBeenCalledWith(
      { cmd: 'catalog.shop.reject' },
      { shopId: '9', reason: 'sabab' },
    );
  });
});
