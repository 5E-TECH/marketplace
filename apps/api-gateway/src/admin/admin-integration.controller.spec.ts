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
      { send: jest.fn() } as never,
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

  it('C1.46: mavjud market tariflarini manual sync qiladi va audit yozadi', async () => {
    const result = { total: 7, updated: 7, failed: 0 };
    const integration = jest.fn(() => of(result));
    const identity = jest.fn(() => of({}));
    const controller = new AdminIntegrationController(
      { send: integration } as never,
      { send: identity } as never,
      { send: jest.fn() } as never,
    );

    await expect(
      controller.syncMarketTariffs(
        { sub: '7', role: Role.SUPERADMIN } as never,
        '1.2.3.4',
      ),
    ).resolves.toEqual(result);
    expect(integration).toHaveBeenCalledWith(
      { cmd: 'integration.market.sync-tariffs' },
      {},
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        actorId: '7',
        action: 'integration.market.sync-tariffs',
        entityType: 'ElchiMarketProvision',
        meta: { ip: '1.2.3.4', ...result },
      }),
    );
  });

  it('C6.7 TC3/TC4: shipment va webhook ro‘yxatini checkoutdan oladi', async () => {
    const checkout = jest.fn(() => of({ items: [], total: 0 }));
    const controller = new AdminIntegrationController(
      { send: jest.fn() } as never,
      { send: jest.fn() } as never,
      { send: checkout } as never,
    );
    await controller.shipments({ page: 1, limit: 20 });
    await controller.webhooks({ page: 2, limit: 10 });
    expect(checkout).toHaveBeenNthCalledWith(
      1,
      { cmd: 'checkout.admin.integration.shipments-list' },
      { query: { page: 1, limit: 20 } },
    );
    expect(checkout).toHaveBeenNthCalledWith(
      2,
      { cmd: 'checkout.admin.integration.webhooks-list' },
      { query: { page: 2, limit: 10 } },
    );
  });

  it('C6.7 TC5: reprovision ishlaydi va audit yozadi', async () => {
    const result = {
      shopId: '4',
      elchiMarketId: '142',
      status: 'done',
      reprovisioned: true,
      error: null,
    };
    const integration = jest.fn(() => of(result));
    const identity = jest.fn(() => of({}));
    const controller = new AdminIntegrationController(
      { send: integration } as never,
      { send: identity } as never,
      { send: jest.fn() } as never,
    );
    await expect(
      controller.reprovision(
        4,
        { sub: '7', role: Role.ADMIN } as never,
        '1.2.3.4',
      ),
    ).resolves.toEqual(result);
    expect(integration).toHaveBeenCalledWith(
      { cmd: 'integration.market.reprovision' },
      { shopId: '4' },
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        action: 'integration.market.reprovision',
        entityId: '4',
      }),
    );
  });
});
