import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { of } from 'rxjs';
import { Role, ROLES_KEY, RolesGuard } from '@app/common';
import { AdminContentController } from './admin-content.controller';
import { StorefrontController } from '../storefront/storefront.controller';

describe('AdminContentController (C6.9)', () => {
  function setup(response: unknown = { id: '3' }) {
    const catalog = { send: jest.fn(() => of(response)) };
    const identity = { send: jest.fn(() => of({ id: '1' })) };
    const files = {
      send: jest.fn(() =>
        of({
          url: 'https://api.elchimarket.uz/media/marketplace-media/banners/a.jpg',
        }),
      ),
    };
    return {
      controller: new AdminContentController(
        catalog as never,
        identity as never,
        files as never,
      ),
      catalog,
      identity,
      files,
    };
  }

  const admin = { sub: '17' } as never;

  it('TC1: banner qo‘shadi va auditga yozadi', async () => {
    const { controller, catalog, identity } = setup();
    const dto = { title: 'Aksiya', imageUrl: 'https://cdn.example.com/a.jpg' };

    await expect(controller.create(dto, admin, '10.0.0.1')).resolves.toEqual({
      id: '3',
    });
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'content.banners.create' },
      dto,
    );
    expect(identity.send).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        actorId: '17',
        action: 'banner.create',
        entityType: 'Banner',
        entityId: '3',
        meta: { ...dto, ip: '10.0.0.1' },
      }),
    );
  });

  it('ro‘yxat, tahrir va tartib to‘g‘ri patternga ketadi', async () => {
    const { controller, catalog } = setup([]);
    await controller.list();
    await controller.update('3', { isActive: false }, admin, '');
    await controller.reorder({ items: [{ id: '3', sortOrder: 0 }] }, admin, '');

    expect(catalog.send).toHaveBeenNthCalledWith(
      1,
      { cmd: 'content.banners.admin-list' },
      {},
    );
    expect(catalog.send).toHaveBeenNthCalledWith(
      2,
      { cmd: 'content.banners.update' },
      { id: '3', dto: { isActive: false } },
    );
    expect(catalog.send).toHaveBeenNthCalledWith(
      3,
      { cmd: 'content.banners.reorder' },
      { items: [{ id: '3', sortOrder: 0 }] },
    );
  });

  it('TC4: o‘chirish catalogga ketadi va auditga tushadi', async () => {
    const { controller, catalog, identity } = setup({
      id: '3',
      deleted: true,
    });
    await expect(controller.remove('3', admin, '10.0.0.1')).resolves.toEqual({
      id: '3',
      deleted: true,
    });
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'content.banners.remove' },
      { id: '3' },
    );
    expect(identity.send).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'banner.delete', entityId: '3' }),
    );
  });

  it('audit yozilmasa ham asosiy amal muvaffaqiyatli qoladi', async () => {
    const catalog = { send: jest.fn(() => of({ id: '3' })) };
    const identity = {
      send: jest.fn(() => {
        throw new Error('identity down');
      }),
    };
    const controller = new AdminContentController(
      catalog as never,
      identity as never,
      { send: jest.fn() } as never,
    );
    await expect(
      controller.create(
        { title: 'A', imageUrl: 'https://cdn.example.com/a.jpg' },
        admin,
        '',
      ),
    ).resolves.toEqual({ id: '3' });
  });

  it('rasmni ochiq banners/ papkasiga yuklaydi', async () => {
    const { controller, files } = setup();
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    await expect(
      controller.uploadImage({
        originalname: 'kuz.jpg',
        mimetype: 'image/jpeg',
        size: buffer.length,
        buffer,
      } as never),
    ).resolves.toEqual({
      url: 'https://api.elchimarket.uz/media/marketplace-media/banners/a.jpg',
    });
    expect(files.send).toHaveBeenCalledWith(
      { cmd: 'file.upload' },
      {
        originalName: 'kuz.jpg',
        mimeType: 'image/jpeg',
        size: 4,
        base64: buffer.toString('base64'),
        folder: 'banners',
      },
    );
  });

  it('fayl yuborilmasa 400 beradi va file-service chaqirilmaydi', async () => {
    const { controller, files } = setup();
    await expect(controller.uploadImage(undefined)).rejects.toThrow(
      'Fayl yuborilmadi',
    );
    expect(files.send).not.toHaveBeenCalled();
  });

  it('`order` route `:id` dan oldin e’lon qilingan', () => {
    // Aks holda PATCH /admin/content/banners/order id sifatida o'qilib,
    // tartib o'zgartirish hech qachon ishlamaydi.
    const methods = Object.getOwnPropertyNames(
      AdminContentController.prototype,
    ).filter((name) =>
      Reflect.hasMetadata(
        PATH_METADATA,
        AdminContentController.prototype[
          name as keyof AdminContentController
        ] as object,
      ),
    );
    expect(methods.indexOf('reorder')).toBeLessThan(methods.indexOf('update'));
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        AdminContentController.prototype.reorder,
      ),
    ).toBe('order');
  });

  it('faqat ADMIN/SUPERADMIN kira oladi, BUYER uchun 403', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminContentController)).toEqual([
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);

    const guard = new RolesGuard(new Reflector());
    const context = (role: Role) =>
      ({
        getHandler: () => AdminContentController.prototype.list,
        getClass: () => AdminContentController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      }) as unknown as ExecutionContext;

    expect(guard.canActivate(context(Role.ADMIN))).toBe(true);
    expect(() => guard.canActivate(context(Role.BUYER))).toThrow(
      ForbiddenException,
    );
  });

  it('TC2: storefront banner endpointi ochiq (token talab qilmaydi)', async () => {
    const catalog = { send: jest.fn(() => of([{ id: '3' }])) };
    const controller = new StorefrontController(catalog as never);

    await expect(controller.banners()).resolves.toEqual([{ id: '3' }]);
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'storefront.banners.list' },
      {},
    );
    // Sinf darajasidagi @Public() butun storefront controllerga tegishli.
    expect(
      Reflect.getMetadata('isPublic', StorefrontController) ??
        Reflect.getMetadata('isPublic', StorefrontController.prototype.banners),
    ).toBe(true);
  });
});
