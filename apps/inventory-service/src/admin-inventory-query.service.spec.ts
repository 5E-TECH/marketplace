import { of } from 'rxjs';
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
    getMany: jest.fn().mockResolvedValue(result),
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
  ] as const)
    value[key].mockReturnValue(value);
  return value;
}

describe('AdminInventoryQueryService (C6.7)', () => {
  it('TC1: barcha shop qoldig‘ini shopId bilan qaytaradi', async () => {
    const qb = builder([
      {
        variantId: '88',
        warehouseId: '3',
        warehouse: { ownerId: '15', name: 'Asosiy ombor' },
        quantityOnHand: 10,
        quantityReserved: 2,
        lowStockThreshold: 3,
      },
    ]);
    const catalog = {
      send: jest.fn(() =>
        of([
          {
            variantId: '88',
            productId: '12',
            productName: 'Telefon',
            variantName: 'Qora',
            sku: 'PHONE-1',
          },
        ]),
      ),
    };
    const service = new AdminInventoryQueryService(
      { createQueryBuilder: jest.fn(() => qb) } as never,
      {} as never,
      catalog as never,
    );
    await expect(
      service.stock({ page: 1, limit: 20, lowOnly: false }),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ shopId: '15', variantId: '88', available: 8 }],
    });
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'inventory.variant-details' },
      { shopId: '15', variantIds: ['88'] },
    );
  });

  it('TC2: movement jurnalini filtr va sahifalash bilan qaytaradi', async () => {
    const row = {
      id: '5',
      variantId: '88',
      warehouseId: '3',
      stock: { warehouse: { ownerId: '15', name: 'Asosiy ombor' } },
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
      {} as never,
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
      items: [{ id: '5', shopId: '15', warehouseName: 'Asosiy ombor' }],
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
