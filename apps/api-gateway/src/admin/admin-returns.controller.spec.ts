import { of, throwError } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { ConfigService } from '@nestjs/config';
import { SignedLinkService } from '../wholesaler-cabinet/signed-link';
import { AdminReturnsController } from './admin-returns.controller';

const links = () =>
  new SignedLinkService(new ConfigService({ JWT_SECRET: 'test-secret' }));

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
      links(),
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

  it('BE-25 (FE-26): rasm havolasi — faqat admin, shu so‘rov rasmi, auditga yoziladi', async () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminReturnsController.prototype.photoLink,
      ),
    ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    const send = jest.fn(() => of({ id: '9' }));
    const audit = jest.fn(() => of({}));
    const svc = links();
    const controller = new AdminReturnsController(
      { send } as never,
      { send: audit } as never,
      svc,
    );
    const link = await controller.photoLink(
      '3',
      '9',
      { sub: '1', role: Role.ADMIN } as never,
      '10.0.0.1',
    );
    expect(send).toHaveBeenCalledWith(
      { cmd: 'checkout.admin.return-photo-get' },
      { photoId: '9', returnId: '3' },
    );
    expect(svc.verify(link.url.split('/').pop()!)).toEqual({
      t: 'return-photo',
      id: '9',
    });
    expect(audit).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'return.photo.view', entityId: '3' }),
    );
    // audit yozilmasa — havola yo‘q
    audit.mockReturnValueOnce(throwError(() => new Error('identity')) as never);
    await expect(
      controller.photoLink(
        '3',
        '9',
        { sub: '1', role: Role.ADMIN } as never,
        '',
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
});
