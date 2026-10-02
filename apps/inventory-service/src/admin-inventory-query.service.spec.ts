import { of, throwError } from 'rxjs';
import { StockMovementType } from '@app/common';
import { AdminInventoryQueryService } from './admin-inventory-query.service';

function builder(result: unknown) {
  const value = {
    innerJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    offset: jest.fn(),
    limit: jest.fn(),
    getManyAndCount: jest.fn().mockResolvedValue(result),
  };
  for (const key of [
    'innerJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
    'offset',
    'limit',
  ] as const)
    value[key].mockReturnValue(value);
  return value;
}

const stockRow = (
  shopId: string,
  variantId: string,
  warehouse: { name?: string; isActive?: boolean } = {},
) => ({
  variantId,
  warehouseId: '3',
  warehouse: {
    ownerId: shopId,
    name: warehouse.name ?? 'Asosiy ombor',
    isActive: warehouse.isActive ?? true,
  },
  quantityOnHand: 10,
  quantityReserved: 2,
  lowStockThreshold: 3,
});

const variant = (variantId: string, name = 'Telefon') => ({
  variantId,
  productId: '12',
  productName: name,
  variantName: 'Qora',
  sku: `SKU-${variantId}`,
});

/** Katalog mock: `variant-details` do'kon bo'yicha, `variant-search` — id'lar. */
function catalogMock(options: {
  details?: Record<string, unknown[] | Error>;
  search?: { variantIds: string[]; truncated: boolean };
}) {
  return {
    send: jest.fn((pattern: { cmd: string }, payload: { shopId?: string }) => {
      if (pattern.cmd === 'catalog.admin.variant-search')
        return of(options.search ?? { variantIds: [], truncated: false });
      const value = options.details?.[payload.shopId ?? ''] ?? [];
      return value instanceof Error ? throwError(() => value) : of(value);
    }),
  };
}

function stockService(
  qb: ReturnType<typeof builder>,
  catalog: ReturnType<typeof catalogMock>,
) {
  return new AdminInventoryQueryService(
    { createQueryBuilder: jest.fn(() => qb) } as never,
    { createQueryBuilder: jest.fn(() => qb) } as never,
    catalog as never,
  );
}

describe('AdminInventoryQueryService (C6.7)', () => {
  it('TC1: barcha shop qoldig‘ini SQL darajasida sahifalab qaytaradi', async () => {
    const qb = builder([[stockRow('15', '88')], 41]);
    const catalog = catalogMock({ details: { '15': [variant('88')] } });

    await expect(
      stockService(qb, catalog).stock({ page: 3, limit: 20, lowOnly: false }),
    ).resolves.toEqual({
      items: [
        {
          shopId: '15',
          variantId: '88',
          productId: '12',
          productName: 'Telefon',
          variantName: 'Qora',
          sku: 'SKU-88',
          catalogMissing: false,
          warehouseId: '3',
          warehouseName: 'Asosiy ombor',
          warehouseActive: true,
          onHand: 10,
          reserved: 2,
          available: 8,
          lowStockThreshold: 3,
        },
      ],
      total: 41,
      page: 3,
      limit: 20,
      totalPages: 3,
      warnings: [],
      searchTruncated: false,
    });
    // Avval hamma qator xotiraga yuklanib, xotirada kesilardi.
    expect(qb.offset).toHaveBeenCalledWith(40);
    expect(qb.limit).toHaveBeenCalledWith(20);
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'inventory.variant-details' },
      { shopId: '15', variantIds: ['88'] },
    );
  });

  it('qidiruv avval katalogda variant id’lariga aylanadi va SQL’ga tushadi', async () => {
    const qb = builder([[stockRow('15', '88')], 1]);
    const catalog = catalogMock({
      search: { variantIds: ['88', '89'], truncated: true },
      details: { '15': [variant('88')] },
    });

    const result = await stockService(qb, catalog).stock({
      search: '  telefon ',
      productId: '12',
      page: 1,
      limit: 20,
      lowOnly: false,
    });

    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'catalog.admin.variant-search' },
      { search: 'telefon', productId: '12' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'stock.variant_id IN (:...variantIds)',
      { variantIds: ['88', '89'] },
    );
    expect(result.searchTruncated).toBe(true);
  });

  it('qidiruvga mos variant bo‘lmasa bazaga so‘rov ketmaydi', async () => {
    const qb = builder([[], 0]);
    const result = await stockService(qb, catalogMock({})).stock({
      search: 'yo‘q',
      page: 1,
      limit: 20,
      lowOnly: false,
    });

    expect(result).toMatchObject({ items: [], total: 0, warnings: [] });
    expect(qb.getManyAndCount).not.toHaveBeenCalled();
  });

  it('bitta do‘kon katalogi yiqilsa qolganlari chiqadi, u esa warnings da', async () => {
    const qb = builder([[stockRow('15', '88'), stockRow('16', '90')], 2]);
    const catalog = catalogMock({
      details: {
        '15': [variant('88')],
        '16': new Error('Mikroservis belgilangan vaqtda javob bermadi'),
      },
    });

    const result = await stockService(qb, catalog).stock({
      page: 1,
      limit: 20,
      lowOnly: false,
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ productName: 'Telefon' });
    // Katalog javob bermagan do'kon qatori nomsiz, lekin "o'chirilgan" emas.
    expect(result.items[1]).toMatchObject({
      shopId: '16',
      productName: null,
      catalogMissing: false,
    });
    // Ichki xato matni sendRpc'da umumiy xabarga almashadi — faqat do'kon muhim.
    expect(result.warnings).toEqual([
      { shopId: '16', reason: expect.any(String) },
    ]);
  });

  it('katalogda topilmagan variant qatori tushib qolmaydi — catalogMissing', async () => {
    const qb = builder([[stockRow('15', '77')], 1]);
    const result = await stockService(
      qb,
      catalogMock({ details: { '15': [] } }),
    ).stock({ page: 1, limit: 20, lowOnly: false });

    expect(result.items).toEqual([
      expect.objectContaining({
        variantId: '77',
        productName: null,
        catalogMissing: true,
        onHand: 10,
      }),
    ]);
  });

  it('qoldiq va harakatlar ombor faolligini BIR XIL filtrlaydi', async () => {
    for (const warehouseActive of [undefined, false]) {
      const stockQb = builder([[stockRow('15', '88', { isActive: false })], 1]);
      const movementQb = builder([[], 0]);
      const service = new AdminInventoryQueryService(
        { createQueryBuilder: jest.fn(() => stockQb) } as never,
        { createQueryBuilder: jest.fn(() => movementQb) } as never,
        catalogMock({ details: { '15': [variant('88')] } }) as never,
      );

      const stock = await service.stock({
        page: 1,
        limit: 20,
        lowOnly: false,
        warehouseActive,
      });
      await service.movementList({ page: 1, limit: 20, warehouseActive });

      for (const qb of [stockQb, movementQb]) {
        const sqls = qb.andWhere.mock.calls.map((call) => String(call[0]));
        if (warehouseActive === undefined) {
          // Sukut bo'yicha o'chirilgan ombor ham ko'rinadi (avval qoldiqda yo'q edi).
          expect(sqls.some((sql) => sql.includes('is_active'))).toBe(false);
        } else {
          expect(qb.andWhere).toHaveBeenCalledWith(
            'warehouse.is_active = :warehouseActive',
            { warehouseActive: false },
          );
        }
      }
      expect(stock.items[0].warehouseActive).toBe(false);
    }
  });

  it('TC2: movement jurnalini filtr, sahifalash va mahsulot nomi bilan qaytaradi', async () => {
    const row = {
      id: '5',
      variantId: '88',
      warehouseId: '3',
      stock: {
        warehouse: { ownerId: '15', name: 'Asosiy ombor', isActive: true },
      },
      type: StockMovementType.INBOUND,
      quantity: 5,
      onHandAfter: 10,
      reservedAfter: 0,
      referenceType: null,
      referenceId: null,
      reason: 'Kirim',
      actorId: '7',
      createdAt: new Date(),
    };
    const qb = builder([[row], 1]);
    const service = new AdminInventoryQueryService(
      {} as never,
      { createQueryBuilder: jest.fn(() => qb) } as never,
      catalogMock({ details: { '15': [variant('88')] } }) as never,
    );
    await expect(
      service.movementList({
        shopId: '15',
        type: StockMovementType.INBOUND,
        page: 1,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      total: 1,
      warnings: [],
      items: [
        {
          id: '5',
          shopId: '15',
          warehouseName: 'Asosiy ombor',
          warehouseActive: true,
          productName: 'Telefon',
          sku: 'SKU-88',
        },
      ],
    });
    expect(qb.andWhere).toHaveBeenCalledWith('warehouse.owner_id = :shopId', {
      shopId: '15',
    });
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(20);
    expect(qb.orderBy).toHaveBeenCalledWith('movement.createdAt', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('movement.id', 'DESC');
  });
});
