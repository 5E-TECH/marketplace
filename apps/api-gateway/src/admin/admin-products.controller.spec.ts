import { of, throwError } from 'rxjs';
import { ROLES_KEY, Role } from '@app/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { AdminProductsController } from './admin-products.controller';
import { PRODUCT_RESULTS_TTL_MS, ProductResultsCache } from './product-results';

describe('AdminProductsController (C4.5)', () => {
  const setup = () => {
    const catalog = jest.fn(() => of({ id: '10' }));
    const identity = jest.fn(() => of({}));
    const files = jest.fn();
    const lead = jest.fn(() => throwError(() => new Error('lead yo‘q')));
    return {
      controller: new AdminProductsController(
        { send: catalog } as never,
        { send: identity } as never,
        { send: files } as never,
        { send: lead } as never,
      ),
      catalog,
      identity,
      files,
      lead,
    };
  };

  it('faqat ADMIN va SUPERADMIN roliga ruxsat beradi', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminProductsController)).toEqual([
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
  });

  it('media: rasm ochiq `products` papkasiga, URL qaytadi; bo‘sh fayl — 400 FILE_REQUIRED', async () => {
    const { controller, files } = setup();
    files.mockReturnValue(
      of({ url: 'https://m/products/1.jpg', mimeType: 'image/jpeg', size: 3 }),
    );
    await expect(
      controller.media({
        originalname: Buffer.from('Қулоқчин.jpg', 'utf8').toString('latin1'),
        mimetype: 'image/jpeg',
        size: 3,
        buffer: Buffer.from([0xff, 0xd8, 0xff]),
      } as never),
    ).resolves.toEqual({
      url: 'https://m/products/1.jpg',
      type: 'IMAGE',
      fileName: 'Қулоқчин.jpg',
      contentType: 'image/jpeg',
      size: 3,
    });
    expect(files).toHaveBeenCalledWith(
      { cmd: 'file.upload' },
      expect.objectContaining({ folder: 'products', size: 3 }),
    );
    await expect(controller.media(undefined)).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ errorCode: 'FILE_REQUIRED' }),
    });
  });

  it('list filterlarni catalog servisiga uzatadi (adminga qator qo‘shimchalari bilan)', async () => {
    const { controller, catalog } = setup();
    catalog.mockReturnValue(of({ items: [], unavailable: [] }) as never);
    const query = { blocked: true, page: 1, limit: 20 } as never;
    await controller.list(query, { sub: '7', role: Role.ADMIN } as never);
    expect(catalog).toHaveBeenCalledWith(
      { cmd: 'catalog.product.admin-list' },
      { query, extras: true },
    );
  });

  it('BE-25 (FE-12): lid javob bermasa — natija null va `unavailable` da', async () => {
    const { controller, catalog } = setup();
    catalog.mockReturnValue(
      of({ items: [{ id: '42' }], unavailable: ['stock'] }) as never,
    );
    await expect(
      controller.list({} as never, { sub: '7', role: Role.ADMIN } as never),
    ).resolves.toEqual({
      items: [{ id: '42', results: null }],
      unavailable: ['stock', 'results'],
    });
  });

  it('BE-25 (FE-12): lid xatosidan keyin eski natija — qatorda bor, lekin `unavailable` da `results`', async () => {
    const { controller, catalog, lead } = setup();
    let now = 0;
    (controller as unknown as { results: ProductResultsCache }).results =
      new ProductResultsCache(
        { send: lead } as never,
        () => new Date(Date.UTC(2027, 0, 14) + now),
      );
    catalog.mockReturnValue(
      of({ items: [{ id: '42' }], unavailable: [] }) as never,
    );
    lead.mockReturnValueOnce(
      of({
        rows: [{ key: '42', leads: 3, confirmed: 1, delivered: 1, refused: 0 }],
        totals: {},
      }) as never,
    );
    const admin = { sub: '7', role: Role.ADMIN } as never;
    await controller.list({} as never, admin);
    now = PRODUCT_RESULTS_TTL_MS;
    const page = (await controller.list({} as never, admin)) as {
      items: Array<{ results: { leads: number } | null }>;
      unavailable: string[];
    };
    expect(page.items[0].results!.leads).toBe(3);
    expect(page.unavailable).toEqual(['results']);
  });

  it('BE-25 (FE-12): natijalar mahsulot bo‘yicha qo‘shiladi (365 kun, offer kesimi); keshdan', async () => {
    const { controller, catalog, lead } = setup();
    catalog.mockReturnValue(
      of({ items: [{ id: '42' }, { id: '43' }], unavailable: [] }) as never,
    );
    const row = {
      key: '42',
      leads: 412,
      clicks: 6100,
      validLeads: 390,
      confirmed: 248,
      delivered: 190,
      refused: 31,
      approveRate: 64,
      saleRate: 86,
      affiliateIncome: 12_350_000,
      epc: 2025,
    };
    lead.mockReturnValue(
      of({ rows: [row, { ...row, key: 'TOTAL' }], totals: row }) as never,
    );
    const admin = { sub: '7', role: Role.ADMIN } as never;
    const page = (await controller.list({} as never, admin)) as {
      items: unknown[];
      unavailable: string[];
    };
    expect(page.items).toEqual([
      {
        id: '42',
        results: {
          leads: 412,
          clicks: 6100,
          validLeads: 390,
          confirmed: 248,
          delivered: 190,
          refused: 31,
          epc: 2025,
          approveRate: 64,
          saleRate: 86,
          revenue: 12_350_000,
        },
      },
      // statistikasi yo‘q mahsulot
      { id: '43', results: null },
    ]);
    expect(page.unavailable).toEqual([]);
    const [, query] = lead.mock.calls[0] as unknown as [
      unknown,
      { from: string; to: string; groupBy: string },
    ];
    expect(query.groupBy).toBe('OFFER');
    expect((Date.parse(query.to) - Date.parse(query.from)) / 86_400_000).toBe(
      365,
    );
    // 5 daqiqa ichida — lid qayta so‘ralmaydi
    await controller.list({} as never, admin);
    expect(lead).toHaveBeenCalledTimes(1);
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

  it('BE-25 (FE-25): arxivlash — catalog `admin-archive`, audit `product.archive`; ID yo‘lda tekshiriladi', async () => {
    const { controller, catalog, identity } = setup();
    catalog.mockReturnValue(of({ id: '10', status: 'ARCHIVED' }));
    await expect(
      controller.archive('10', { sub: '3' } as never, '10.0.0.1'),
    ).resolves.toEqual({ id: '10', status: 'ARCHIVED' });
    expect(catalog).toHaveBeenCalledWith(
      { cmd: 'catalog.product.admin-archive' },
      { productId: '10' },
    );
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        action: 'product.archive',
        entityType: 'Product',
        entityId: '10',
      }),
    );
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      AdminProductsController,
      'archive',
    ) as Record<string, { data?: string; pipes?: unknown[] }>;
    expect(Object.values(args).find((a) => a.data === 'id')?.pipes).toContain(
      ParseLeadIdPipe,
    );
  });

  it('BE-25 (FE-25): catalog 409 (sotuvda, qoldiq bor) — audit yozilmaydi', async () => {
    const { controller, catalog, identity } = setup();
    catalog.mockReturnValue(
      throwError(() => ({
        status: 409,
        message: 'Sotuvdagi mahsulot arxivlanmaydi — avval to‘xtating',
      })),
    );
    await expect(
      controller.archive('10', { sub: '3' } as never, '10.0.0.1'),
    ).rejects.toMatchObject({ status: 409 });
    expect(identity).not.toHaveBeenCalled();
  });
});
