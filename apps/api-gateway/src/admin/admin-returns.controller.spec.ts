import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminReturnsController } from './admin-returns.controller';

describe('AdminReturnsController (C4.2)', () => {
  it('ko‘rish va qaror — ADMIN/SUPERADMIN, pul qaytarish — faqat SUPERADMIN', () => {
    for (const method of ['list', 'get', 'approve', 'reject'] as const) {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          AdminReturnsController.prototype[method],
        ),
      ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    }
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminReturnsController.prototype.refund),
    ).toEqual([Role.SUPERADMIN]);
  });

  it('qisman refund checkoutga uzatiladi va audit jurnaliga yoziladi', async () => {
    const send = jest.fn(() => of({ id: '3', status: 'REFUNDED' }));
    const audit = jest.fn(() => of({}));
    const controller = new AdminReturnsController(
      { send } as never,
      { send: audit } as never,
    );
    const admin = { sub: '1', role: Role.SUPERADMIN };
    const dto = { amount: 150000, restock: false, comment: 'Qisman' };

    await expect(
      controller.refund('3', dto, admin as never, '10.0.0.1'),
    ).resolves.toMatchObject({ status: 'REFUNDED' });

    expect(send).toHaveBeenCalledWith(
      { cmd: 'checkout.admin.return-refund' },
      {
        returnId: '3',
        actor: { id: '1', role: Role.SUPERADMIN },
        amount: 150000,
        restock: false,
        comment: 'Qisman',
      },
    );
    expect(audit).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        action: 'return.refund',
        entityType: 'ReturnRequest',
        entityId: '3',
      }),
    );
  });
});
