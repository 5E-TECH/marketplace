import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
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
});
