import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { Role, ROLES_KEY, RolesGuard } from '@app/common';
import { AdminTeamController } from './admin-team.controller';

describe('AdminTeamController (C6.1)', () => {
  function setup() {
    const send = jest.fn(() => of({}));
    return { send, controller: new AdminTeamController({ send } as never) };
  }

  it('TC1/TC2/TC3: barcha amallar identity servisiga actor bilan uzatiladi', async () => {
    const { send, controller } = setup();
    const actor = { sub: '1', role: Role.SUPERADMIN } as never;
    const createDto = {
      name: 'Admin',
      phone: '+998901112233',
      role: Role.ADMIN,
      password: 'Secret123',
    } as const;

    await controller.list(actor);
    await controller.create(actor, createDto, '1.2.3.4');
    await controller.updateRole(
      actor,
      '7',
      { role: Role.SUPERADMIN },
      '1.2.3.4',
    );
    await controller.remove(actor, '7', '1.2.3.4');

    expect(send.mock.calls).toEqual([
      [{ cmd: 'identity.admin-team.list' }, { actorId: '1' }],
      [
        { cmd: 'identity.admin-team.create' },
        { actorId: '1', dto: createDto, ip: '1.2.3.4' },
      ],
      [
        { cmd: 'identity.admin-team.role.update' },
        {
          actorId: '1',
          memberId: '7',
          dto: { role: Role.SUPERADMIN },
          ip: '1.2.3.4',
        },
      ],
      [
        { cmd: 'identity.admin-team.delete' },
        { actorId: '1', memberId: '7', ip: '1.2.3.4' },
      ],
    ]);
  });

  it('TC4: barcha endpoint faqat SUPERADMIN uchun', () => {
    const guard = new RolesGuard(new Reflector());
    for (const method of ['list', 'create', 'updateRole', 'remove'] as const) {
      const handler = AdminTeamController.prototype[method];
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
        Role.SUPERADMIN,
      ]);
      const context = (role: Role) =>
        ({
          getHandler: () => handler,
          getClass: () => AdminTeamController,
          switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
        }) as unknown as ExecutionContext;
      expect(guard.canActivate(context(Role.SUPERADMIN))).toBe(true);
      expect(() => guard.canActivate(context(Role.ADMIN))).toThrow(
        ForbiddenException,
      );
    }
  });
});
