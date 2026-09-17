import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminIntegrationController } from './admin-integration.controller';

describe('AdminIntegrationController (C1.44)', () => {
  it('faqat ADMIN va SUPERADMIN uchun manual geo sync qiladi va audit yozadi', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminIntegrationController)).toEqual([
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
    const result = {
      regions: 14,
      districts: 181,
      added: 1,
      updated: 2,
      deleted: 3,
    };
    const integration = jest.fn(() => of(result));
    const identity = jest.fn(() => of({}));
    const controller = new AdminIntegrationController(
      { send: integration } as never,
      { send: identity } as never,
    );

    await expect(
      controller.syncGeo({ sub: '7', role: Role.ADMIN } as never, '1.2.3.4'),
    ).resolves.toEqual(result);
    expect(integration).toHaveBeenCalledWith(
      { cmd: 'integration.geo.sync' },
      {},
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        actorId: '7',
        action: 'integration.geo.sync',
        entityType: 'GeoCache',
        meta: { ip: '1.2.3.4', ...result },
      }),
    );
  });
});
