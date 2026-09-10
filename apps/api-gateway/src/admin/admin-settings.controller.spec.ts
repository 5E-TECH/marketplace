import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { Role, ROLES_KEY, RolesGuard } from '@app/common';
import { AdminSettingsController } from './admin-settings.controller';

describe('AdminSettingsController (C6.2)', () => {
  it('TC1: joriy sozlamalarni identity servisidan oladi', async () => {
    const send = jest.fn(() => of({ commissionPercent: 5 }));
    const controller = new AdminSettingsController({ send } as never);

    await controller.get();

    expect(send).toHaveBeenCalledWith({ cmd: 'identity.settings.get' }, {});
  });

  it('TC2: actor, IP va qiymatlarni update patterniga uzatadi', async () => {
    const send = jest.fn(() => of({ commissionPercent: 7.5 }));
    const controller = new AdminSettingsController({ send } as never);
    const dto = {
      commissionPercent: 7.5,
      minimumOrderAmount: 50000,
      supportPhone: '+998712000000',
    };

    await controller.update({ sub: '17' } as never, dto, '127.0.0.1');

    expect(send).toHaveBeenCalledWith(
      { cmd: 'identity.settings.update' },
      { actorId: '17', dto, ip: '127.0.0.1' },
    );
  });

  it('TC4: GET adminlarga, PUT faqat SUPERADMINga ruxsat beradi', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminSettingsController.prototype.get),
    ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminSettingsController.prototype.update),
    ).toEqual([Role.SUPERADMIN]);

    const guard = new RolesGuard(new Reflector());
    const context = (handler: unknown, role: Role) =>
      ({
        getHandler: () => handler,
        getClass: () => AdminSettingsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      }) as unknown as ExecutionContext;

    expect(
      guard.canActivate(
        context(AdminSettingsController.prototype.get, Role.ADMIN),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        context(AdminSettingsController.prototype.update, Role.ADMIN),
      ),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(
        context(AdminSettingsController.prototype.update, Role.SUPERADMIN),
      ),
    ).toBe(true);
  });
});
