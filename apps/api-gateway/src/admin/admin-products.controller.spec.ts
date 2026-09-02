import { of } from 'rxjs';
import { ROLES_KEY, Role } from '@app/common';
import { AdminProductsController } from './admin-products.controller';

describe('AdminProductsController (C4.5)', () => {
  const setup = () => {
    const catalog = jest.fn(() => of({ id: '10' }));
    const identity = jest.fn(() => of({}));
    return {
      controller: new AdminProductsController(
        { send: catalog } as never,
        { send: identity } as never,
      ),
      catalog,
      identity,
    };
  };

  it('faqat ADMIN va SUPERADMIN roliga ruxsat beradi', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminProductsController)).toEqual([
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
  });

  it('list filterlarni catalog servisiga uzatadi', async () => {
    const { controller, catalog } = setup();
    const query = { blocked: true, page: 1, limit: 20 } as never;
    await controller.list(query);
    expect(catalog).toHaveBeenCalledWith(
      { cmd: 'catalog.product.admin-list' },
      { query },
    );
  });

  it('suspend va reactivate amallarini audit qiladi', async () => {
    const { controller, catalog, identity } = setup();
    const admin = { sub: '7', role: Role.ADMIN } as never;

    await controller.suspend('10', admin, '1.2.3.4');
    await controller.reactivate('10', admin, '1.2.3.4');

    expect(catalog).toHaveBeenNthCalledWith(
      1,
      { cmd: 'catalog.product.admin-suspend' },
      { productId: '10' },
    );
    expect(catalog).toHaveBeenNthCalledWith(
      2,
      { cmd: 'catalog.product.admin-reactivate' },
      { productId: '10' },
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        actorId: '7',
        action: 'product.suspend',
        entityType: 'Product',
        entityId: '10',
      }),
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'product.reactivate' }),
    );
  });
});
