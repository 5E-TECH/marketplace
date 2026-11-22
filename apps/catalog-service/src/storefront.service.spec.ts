import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CatalogOfferSnapshot, StorefrontProductsQueryDto } from '@app/common';
import { RELATED_LIMIT, StorefrontService } from './storefront.service';

/** BE-34: asosiy sayt katalogi — tasdiqlangan narx, ichki maydonlarsiz (TC3), narx oralig‘i (TC4). */
describe('StorefrontService (BE-34)', () => {
  const offer = (
    productId: string,
    overrides: Partial<CatalogOfferSnapshot> = {},
  ): CatalogOfferSnapshot => ({
    productId,
    name: `Mahsulot ${productId}`,
    subtitle: null,
    description: 'Tavsif',
    images: [`https://cdn/${productId}.webp`],
    videoUrl: 'https://cdn/v.mp4',
    categoryId: '7',
    categoryName: 'Quloqchinlar',
    attributes: [{ name: 'Rang', value: 'Qora' }],
    weightGrams: 300,
    isBad: false,
    cpaAvailable: true,
    withdrawn: false,
    approvedPrice: 100_000 * Number(productId),
    maxSalePrice: 150_000 * Number(productId),
    affiliateFee: 40_000,
    centerDeliveryFee: 25_000,
    addressDeliveryFee: 35_000,
    stock: 5,
    creatives: [],
    createdAt: '2026-11-20T10:00:00.000Z',
    ...overrides,
  });
  const query = (values: Partial<StorefrontProductsQueryDto> = {}) =>
    Object.assign(new StorefrontProductsQueryDto(), values);

  function setup(rows: CatalogOfferSnapshot[]) {
    const offers = {
      list: jest.fn(async () => rows),
      get: jest.fn(
        async (id: string) => rows.find((row) => row.productId === id) ?? null,
      ),
    };
    const variants = {
      findOne: jest.fn(async ({ where }: { where: { productId: string } }) =>
        rows.some((row) => row.productId === where.productId)
          ? {
              id: `v${where.productId}`,
              productId: where.productId,
              product: { shopId: '3' },
            }
          : null,
      ),
    };
    return {
      service: new StorefrontService(offers as never, variants as never),
      offers,
      variants,
    };
  }

  it('TC3: javobda faqat ochiq maydonlar — bazaviy narx, sotuvchi haqi, eng katta narx, qoldiq soni yo‘q', async () => {
    const { service } = setup([offer('1')]);
    const page = await service.listProducts(query());
    expect(Object.keys(page.items[0]).sort()).toEqual(
      [
        'attributes',
        'category',
        'deliveryToAddress',
        'deliveryToCenter',
        'description',
        'id',
        'images',
        'inStock',
        'isBad',
        'name',
        'price',
        'subtitle',
        'videoUrl',
      ].sort(),
    );
    expect(page.items[0]).toMatchObject({
      id: '1',
      price: 100_000, // SAYT-2: tasdiqlangan narx
      category: { id: '7', name: 'Quloqchinlar' },
      inStock: true,
    });
    const details = await service.getProduct('1');
    expect(JSON.stringify(details)).not.toMatch(
      /"(affiliateFee|maxSalePrice|approvedPrice|basePrice|stock|weightGrams|tin|bank\w*|mfo)"/i,
    );
  });

  it('TC4: narx oralig‘i — faqat shu oraliqdagi mahsulotlar; min > max — 400', async () => {
    const { service } = setup(['1', '2', '3', '4'].map((id) => offer(id)));
    const page = await service.listProducts(
      query({ minPrice: 200_000, maxPrice: 300_000 }),
    );
    expect(page.items.map((item) => item.id)).toEqual(['2', '3']);
    expect(page.total).toBe(2);
    await expect(
      service.listProducts(query({ minPrice: 5, maxPrice: 1 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('saytda faqat sotuvdagi, sotuvchilarga ochiq va narxi tasdiqlangan mahsulot', async () => {
    const { service } = setup([
      offer('1'),
      offer('2', { withdrawn: true }),
      offer('3', { cpaAvailable: false }),
      offer('4', { approvedPrice: null }),
    ]);
    expect(
      (await service.listProducts(query())).items.map((item) => item.id),
    ).toEqual(['1']);
    for (const id of ['2', '3', '4'])
      await expect(service.getProduct(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    await expect(service.getProduct('99')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('«faqat mavjud» — qoldig‘i 0 chiqmaydi, noma’lum (ombor javob bermadi) ko‘rsatiladi', async () => {
    const { service } = setup([
      offer('1', { stock: 0 }),
      offer('2', { stock: null }),
      offer('3'),
    ]);
    const all = await service.listProducts(query());
    expect(all.items.map((item) => [item.id, item.inStock])).toEqual([
      ['1', false],
      ['2', null],
      ['3', true],
    ]);
    const available = await service.listProducts(query({ inStock: true }));
    expect(available.items.map((item) => item.id)).toEqual(['2', '3']);
  });

  it('saralash va sahifalash', async () => {
    const { service } = setup(['1', '2', '3'].map((id) => offer(id)));
    const cheap = await service.listProducts(
      query({ sort: 'price:asc', page: 1, limit: 2 }),
    );
    expect(cheap.items.map((item) => item.id)).toEqual(['1', '2']);
    expect(cheap).toMatchObject({ total: 3, totalPages: 2 });
    const second = await service.listProducts(
      query({ sort: 'price:asc', page: 2, limit: 2 }),
    );
    expect(second.items.map((item) => item.id)).toEqual(['3']);
    const oldest = await service.listProducts(query({ sort: 'createdAt:asc' }));
    expect(oldest.items.map((item) => item.id)).toEqual(['3', '2', '1']);
  });

  it('«Shu bo‘limdan» — shu kategoriyadagi boshqa sotuvdagi mahsulotlar, o‘zi emas, chegara bilan', async () => {
    const rows = Array.from({ length: RELATED_LIMIT + 3 }, (_, index) =>
      offer(String(index + 1)),
    );
    rows.push(offer('50', { withdrawn: true }));
    const { service, offers } = setup(rows);
    const details = await service.getProduct('1');
    expect(offers.list).toHaveBeenCalledWith({ categoryId: '7' });
    expect(details.related).toHaveLength(RELATED_LIMIT);
    expect(details.related.map((item) => item.id)).not.toContain('1');
    expect(details.related.map((item) => item.id)).not.toContain('50');
  });

  it('savatga: tasdiqlangan narx va yagona faol variant; sotuvda bo‘lmasa 404', async () => {
    const { service, variants } = setup([
      offer('1'),
      offer('2', { approvedPrice: null }),
    ]);
    await expect(service.cartVariant('1')).resolves.toEqual({
      productId: '1',
      variantId: 'v1',
      shopId: '3',
      unitPrice: 100_000,
      productName: 'Mahsulot 1',
    });
    expect(variants.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: '1', isActive: true, isDeleted: false },
      }),
    );
    await service.cartVariant('1', '9');
    expect(variants.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { productId: '1', isActive: true, isDeleted: false, id: '9' },
      }),
    );
    await expect(service.cartVariant('2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
