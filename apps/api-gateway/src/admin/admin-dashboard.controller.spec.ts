import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminDashboardController } from './admin-dashboard.controller';

function makeController(
  catalog: jest.Mock,
  identity: jest.Mock,
  checkout: jest.Mock,
) {
  return new AdminDashboardController(
    { send: catalog } as never,
    { send: identity } as never,
    { send: checkout } as never,
  );
}

describe('AdminDashboardController (C1.28)', () => {
  it('TC2/TC5: dashboard faqat ADMIN va SUPERADMIN (@Roles)', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminDashboardController.prototype.dashboard,
      ),
    ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
  });

  it('TC1: uch servisdan parallel yig‘ib bitta javobga jamlaydi', async () => {
    const catalog = jest.fn(() =>
      of({ total: 12, PENDING: 3, ACTIVE: 8, SUSPENDED: 1, REJECTED: 0 }),
    );
    const identity = jest.fn(() =>
      of({
        total: 41,
        AFFILIATE: 25,
        WHOLESALER: 3,
        OPERATOR_LEAD: 6,
        SUPERVISOR: 1,
        WAREHOUSE: 2,
        FINANCE: 1,
        ADMIN: 2,
        SUPERADMIN: 1,
      }),
    );
    const checkout = jest.fn(() =>
      of({ ordersTotal: 320, ordersToday: 7, gmv: 54000000, revenue: 2700000 }),
    );
    const ctrl = makeController(catalog, identity, checkout);

    const res = await ctrl.dashboard();

    expect(catalog).toHaveBeenCalledWith(
      { cmd: 'catalog.shop.count-by-status' },
      {},
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.user.count-by-role' },
      {},
    );
    expect(checkout).toHaveBeenCalledWith({ cmd: 'checkout.admin.stats' }, {});
    expect(res).toEqual({
      shops: { total: 12, pending: 3, active: 8, suspended: 1, rejected: 0 },
      users: {
        total: 41,
        sellers: 25,
        wholesalers: 3,
        operators: 6,
        supervisors: 1,
        warehouse: 2,
        finance: 1,
        admins: 2,
      },
      orders: { total: 320, today: 7 },
      gmv: 54000000,
      revenue: 2700000,
    });
  });

  it('TC3: yangi platforma -> hamma 0, xato yo‘q', async () => {
    const ctrl = makeController(
      jest.fn(() =>
        of({ total: 0, PENDING: 0, ACTIVE: 0, SUSPENDED: 0, REJECTED: 0 }),
      ),
      jest.fn(() =>
        of({
          total: 0,
          AFFILIATE: 0,
          WHOLESALER: 0,
          OPERATOR_LEAD: 0,
          SUPERVISOR: 0,
          WAREHOUSE: 0,
          FINANCE: 0,
          ADMIN: 0,
          SUPERADMIN: 0,
        }),
      ),
      jest.fn(() => of({ ordersTotal: 0, ordersToday: 0, gmv: 0, revenue: 0 })),
    );

    await expect(ctrl.dashboard()).resolves.toEqual({
      shops: { total: 0, pending: 0, active: 0, suspended: 0, rejected: 0 },
      users: {
        total: 0,
        sellers: 0,
        wholesalers: 0,
        operators: 0,
        supervisors: 0,
        warehouse: 0,
        finance: 0,
        admins: 0,
      },
      orders: { total: 0, today: 0 },
      gmv: 0,
      revenue: 0,
    });
  });
});
