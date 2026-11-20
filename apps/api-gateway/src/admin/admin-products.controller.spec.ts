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

  it('BE-07: optovik uchun mahsulot yaratadi va admin harakatini audit qiladi', async () => {
    const { controller, catalog, identity } = setup();
    const admin = { sub: '7', role: Role.ADMIN } as never;
    const body = {
      wholesalerId: '9',
      name: 'Telefon',
      imageUrl: 'https://cdn.example.com/telefon.jpg',
      basePrice: 140000,
      weightGrams: 450,
      lengthMm: 200,
      widthMm: 120,
      heightMm: 80,
    };

    await controller.create(body, admin, '1.2.3.4');

    expect(catalog).toHaveBeenCalledWith(
      { cmd: 'catalog.product.admin-create' },
      { dto: body },
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        actorId: '7',
        action: 'product.create',
        entityType: 'Product',
        entityId: '10',
        meta: { wholesalerId: '9', ip: '1.2.3.4' },
      }),
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

  it('C6.6: hide sababni catalogga uzatadi va audit qiladi', async () => {
    const { controller, catalog, identity } = setup();
    const admin = { sub: '7', role: Role.SUPERADMIN } as never;

    await controller.hide(
      '10',
      { reason: 'Noto‘g‘ri tavsif' },
      admin,
      '1.2.3.4',
    );

    expect(catalog).toHaveBeenCalledWith(
      { cmd: 'catalog.product.admin-hide' },
      { productId: '10', reason: 'Noto‘g‘ri tavsif' },
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        action: 'product.hide',
        entityId: '10',
        meta: { reason: 'Noto‘g‘ri tavsif', ip: '1.2.3.4' },
      }),
    );
  });
});
