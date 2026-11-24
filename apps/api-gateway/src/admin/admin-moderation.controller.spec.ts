import { of } from 'rxjs';
import { CATALOG_MODERATION_RPC, Role, ROLES_KEY } from '@app/common';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminPricingController } from './admin-pricing.controller';

/** BE-25 (FE-13): narx navbati va bozor narxini oldindan ko‘rish. */
describe('Narx moderatsiyasi', () => {
  it('narx navbati — admin va superadmin; katalogdan', async () => {
    const send = jest.fn(() => of({ items: [], total: 0 }));
    const controller = new AdminModerationController({ send } as never);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminModerationController.prototype.prices,
      ),
    ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    await expect(controller.prices()).resolves.toEqual({ items: [], total: 0 });
    expect(send).toHaveBeenCalledWith(
      { cmd: CATALOG_MODERATION_RPC.PRICES },
      {},
    );
  });

  it('bozor narxi: oldindan ko‘rish auditga yozilmaydi, saqlash — manba bilan yoziladi', async () => {
    const catalog = jest.fn(() => of({ verdict: 'MOS' }));
    const identity = jest.fn(() => of({}));
    const controller = new AdminPricingController(
      { send: catalog } as never,
      { send: identity } as never,
    );
    const admin = { sub: '7', role: Role.ADMIN } as never;
    const preview = { competitorTotal: 285000, preview: true };
    await controller.market('42', preview, admin, '1.2.3.4');
    expect(catalog).toHaveBeenLastCalledWith(
      { cmd: 'catalog.pricing.market-check' },
      { productId: '42', dto: preview },
    );
    expect(identity).not.toHaveBeenCalled();
    const saved = { competitorTotal: 285000, source: 'Uzum Market' };
    await controller.market('42', saved, admin, '1.2.3.4');
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        action: 'price.market-check',
        entityId: '42',
        meta: expect.objectContaining(saved),
      }),
    );
  });
});
