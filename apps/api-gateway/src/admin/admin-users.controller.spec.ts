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

  it('C6.5: role va impersonate faqat SUPERADMIN uchun', () => {
    for (const method of ['updateRole', 'impersonate'] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, AdminUsersController.prototype[method]),
      ).toEqual([Role.SUPERADMIN]);
    }
  });

  it('C6.5: role update va impersonate identity servisiga uzatiladi', async () => {
    const send = jest.fn(() => of({ id: '9' }));
    const ctrl = makeController(send);
    const actor = { sub: '1', role: Role.SUPERADMIN } as never;

    await ctrl.updateRole(actor, '9', { role: Role.SELLER }, '1.2.3.4');
    await ctrl.impersonate(actor, '9', '1.2.3.4');

    expect(send).toHaveBeenNthCalledWith(
      1,
      { cmd: 'identity.user.role.update' },
      {
        actorId: '1',
        userId: '9',
        dto: { role: Role.SELLER },
        ip: '1.2.3.4',
      },
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      { cmd: 'identity.user.impersonate' },
      { actorId: '1', userId: '9', ip: '1.2.3.4' },
    );
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
    await ctrl.block({ sub: '1', role: Role.ADMIN } as never, '9', '');
    expect(send).toHaveBeenCalledWith(
      { cmd: 'identity.user.set-blocked' },
      { actorId: '1', userId: '9', blocked: true },
    );
  });

  it('unblock -> set-blocked{blocked:false}', async () => {
    const send = jest.fn(() => of({}));
    const ctrl = makeController(send);
    await ctrl.unblock({ sub: '1', role: Role.ADMIN } as never, '9', '');
    expect(send).toHaveBeenCalledWith(
      { cmd: 'identity.user.set-blocked' },
      { actorId: '1', userId: '9', blocked: false },
    );
  });

  it('C1.31: block -> audit.log ham yuboriladi (actor=admin, ip, resource)', async () => {
    const send = jest.fn(() => of({}));
    const ctrl = makeController(send);
    await ctrl.block({ sub: '1', role: Role.ADMIN } as never, '9', '1.2.3.4');
    expect(send).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      {
        actorId: '1',
        action: 'user.block',
        entityType: 'User',
        entityId: '9',
        meta: { ip: '1.2.3.4' },
      },
    );
  });
});
