import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminUsersController } from './admin-users.controller';

function makeController(send: jest.Mock) {
  return new AdminUsersController({ send } as never);
}

describe('AdminUsersController (C1.29)', () => {
  it('TC5: barcha admin route faqat ADMIN/SUPERADMIN (@Roles)', () => {
    for (const m of ['list', 'get', 'block', 'unblock'] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, AdminUsersController.prototype[m]),
      ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    }
  });

  it('TC1: list -> identity.user.admin-list ga query uzatiladi', async () => {
    const send = jest.fn(() => of({ items: [], total: 0 }));
    const ctrl = makeController(send);
    await ctrl.list({ role: Role.SELLER, page: 1, limit: 20 } as never);
    expect(send).toHaveBeenCalledWith(
      { cmd: 'identity.user.admin-list' },
      { query: { role: Role.SELLER, page: 1, limit: 20 } },
    );
  });

  it('get -> identity.user.admin-get ga userId', async () => {
    const send = jest.fn(() => of({ id: '9' }));
    const ctrl = makeController(send);
    await ctrl.get('9');
    expect(send).toHaveBeenCalledWith(
      { cmd: 'identity.user.admin-get' },
      { userId: '9' },
    );
  });

  it('block -> set-blocked{actorId=joriy admin, blocked:true}', async () => {
    const send = jest.fn(() => of({}));
    const ctrl = makeController(send);
    await ctrl.block({ sub: '1', role: Role.ADMIN } as never, '9');
    expect(send).toHaveBeenCalledWith(
      { cmd: 'identity.user.set-blocked' },
      { actorId: '1', userId: '9', blocked: true },
    );
  });

  it('unblock -> set-blocked{blocked:false}', async () => {
    const send = jest.fn(() => of({}));
    const ctrl = makeController(send);
    await ctrl.unblock({ sub: '1', role: Role.ADMIN } as never, '9');
    expect(send).toHaveBeenCalledWith(
      { cmd: 'identity.user.set-blocked' },
      { actorId: '1', userId: '9', blocked: false },
    );
  });
});
