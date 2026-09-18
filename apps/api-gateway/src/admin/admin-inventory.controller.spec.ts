import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminInventoryController } from './admin-inventory.controller';

describe('AdminInventoryController (C6.7)', () => {
  it('TC1/TC2: ADMIN/SUPERADMIN global stock va movement RPCni chaqiradi', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminInventoryController)).toEqual([
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
    const send = jest.fn(() => of({ items: [], total: 0 }));
    const controller = new AdminInventoryController({ send } as never);
    await controller.stock({ page: 1, limit: 20, lowOnly: false });
    await controller.movements({ page: 1, limit: 20 });
    expect(send).toHaveBeenNthCalledWith(
      1,
      { cmd: 'inventory.admin.stock-list' },
      { query: { page: 1, limit: 20, lowOnly: false } },
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      { cmd: 'inventory.admin.movements-list' },
      { query: { page: 1, limit: 20 } },
    );
  });
});
