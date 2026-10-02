import {
  ADMIN_VARIANT_SEARCH_LIMIT,
  ProductVariantService,
} from './product-variant.service';

function searchService(rows: Array<{ id: string }>) {
  const qb = {
    innerJoin: jest.fn(),
    select: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
  for (const key of [
    'innerJoin',
    'select',
    'where',
    'andWhere',
    'orderBy',
    'limit',
  ] as const)
    qb[key].mockReturnValue(qb);
  const service = new ProductVariantService(
    {} as never,
    { createQueryBuilder: jest.fn(() => qb) } as never,
  );
  return { service, qb };
}

describe('ProductVariantService.searchVariantIdsForAdmin (C6.7)', () => {
  it('nom/variant/SKU bo‘yicha qidiradi, % va _ joker bo‘lib qolmaydi', async () => {
    const { service, qb } = searchService([{ id: '88' }]);

    await expect(
      service.searchVariantIdsForAdmin({
        search: ' 50%_off ',
        productId: '12',
      }),
    ).resolves.toEqual({ variantIds: ['88'], truncated: false });

    expect(qb.andWhere).toHaveBeenCalledWith(
      'variant.product_id = :productId',
      {
        productId: '12',
      },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('variant.sku ILIKE :pattern'),
      { pattern: '%50\\%\\_off%' },
    );
    expect(qb.limit).toHaveBeenCalledWith(ADMIN_VARIANT_SEARCH_LIMIT + 1);
  });

  it('chegaradan oshsa kesiladi va truncated bo‘ladi', async () => {
    const rows = Array.from(
      { length: ADMIN_VARIANT_SEARCH_LIMIT + 1 },
      (_, i) => ({ id: String(i + 1) }),
    );
    const { service } = searchService(rows);

    const result = await service.searchVariantIdsForAdmin({ search: 'a' });

    expect(result.truncated).toBe(true);
    expect(result.variantIds).toHaveLength(ADMIN_VARIANT_SEARCH_LIMIT);
  });
});
