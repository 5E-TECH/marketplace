import { of } from 'rxjs';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, ROLES_KEY, RolesGuard } from '@app/common';
import { AdminAuditController } from './admin-audit.controller';

describe('AdminAuditController (C6.3)', () => {
  it('TC1/TC2/TC3: filterlarni identity audit list patterniga uzatadi', async () => {
    const send = jest.fn(() => of({ items: [], total: 0 }));
    const controller = new AdminAuditController({ send } as never);
    const query = {
      actorId: '7',
      action: 'shop.suspend',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-07',
      page: 1,
      limit: 20,
    };

    await controller.list(query);
    expect(send).toHaveBeenCalledWith(
      { cmd: 'identity.audit.list' },
      { query },
    );
  });

  it('TC4: faqat ADMIN va SUPERADMIN ruxsatli', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminAuditController.prototype.list),
    ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
  });

  it.each(Object.values(Role))(
    'TC4: %s roli haqiqiy guard orqali tekshiriladi',
    (role) => {
      const context = {
        getHandler: () => AdminAuditController.prototype.list,
        getClass: () => AdminAuditController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      } as unknown as ExecutionContext;
      const guard = new RolesGuard(new Reflector());
      if (role === Role.ADMIN || role === Role.SUPERADMIN) {
        expect(guard.canActivate(context)).toBe(true);
      } else {
        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      }
    },
  );
});
