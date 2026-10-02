import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminNotificationsController } from './admin-notifications.controller';

const roles = (method: keyof AdminNotificationsController) =>
  Reflect.getMetadata(
    ROLES_KEY,
    AdminNotificationsController.prototype[method],
  );

function setup(sendResult: unknown = {}) {
  const notifications = { send: jest.fn(() => of(sendResult)) };
  const identity = { send: jest.fn(() => of({})) };
  const controller = new AdminNotificationsController(
    notifications as never,
    identity as never,
  );
  return { controller, notifications, identity };
}

const superadmin = { sub: '1', role: Role.SUPERADMIN } as never;
const message = {
  audience: 'sellers' as const,
  channels: [],
  title: 'Aksiya',
  body: 'Bugun 20% chegirma',
};

describe('AdminNotificationsController (C6.8)', () => {
  it('TC4: ommaviy xabarni faqat SUPERADMIN ko‘radi va yuboradi', () => {
    expect(roles('preview')).toEqual([Role.SUPERADMIN]);
    expect(roles('send')).toEqual([Role.SUPERADMIN]);
  });

  it('shablonlar va tarix ADMIN/SUPERADMIN uchun', () => {
    for (const method of [
      'templates',
      'updateTemplate',
      'resetTemplate',
      'broadcasts',
    ] as const) {
      expect(roles(method)).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    }
  });

  it('shablon tahriri notification servisiga ketadi va auditga yoziladi', async () => {
    const { controller, notifications, identity } = setup({
      key: 'shop_approved',
    });
    const dto = { title: 'Tabriklaymiz', body: '{shopName} sotuvda' };

    await controller.updateTemplate(
      'shop_approved',
      dto,
      superadmin,
      '10.0.0.1',
    );

    expect(notifications.send).toHaveBeenCalledWith(
      { cmd: 'notification.admin.templates.update' },
      { key: 'shop_approved', dto, actorId: '1' },
    );
    expect(identity.send).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        action: 'notification.template.update',
        entityId: 'shop_approved',
      }),
    );
  });

  it('yuborish token bilan uzatiladi; yangi xabar auditga yoziladi', async () => {
    const { controller, notifications, identity } = setup({
      id: '7',
      recipientsCount: 42,
    });
    const dto = { ...message, previewToken: 'a'.repeat(64) };

    await controller.send(dto, superadmin, '10.0.0.1');

    expect(notifications.send).toHaveBeenCalledWith(
      { cmd: 'notification.admin.broadcast.send' },
      { dto, actorId: '1' },
    );
    expect(identity.send).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        action: 'notification.broadcast.send',
        entityId: '7',
        meta: expect.objectContaining({
          audience: 'sellers',
          recipientsCount: 42,
        }),
      }),
    );
  });

  it('takroriy bosish (idempotent) auditni ikkilantirmaydi', async () => {
    const { controller, identity } = setup({ id: '7', idempotent: true });

    await controller.send(
      { ...message, previewToken: 'a'.repeat(64) },
      superadmin,
      '10.0.0.1',
    );

    expect(identity.send).not.toHaveBeenCalled();
  });
});
