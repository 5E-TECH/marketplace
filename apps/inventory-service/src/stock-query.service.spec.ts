import { of } from 'rxjs';
import { WarehouseOwnerType } from '@app/common';
import { Stock } from './entities/stock.entity';
import { StockQueryService } from './stock-query.service';

function queryBuilderWith(stocks: Stock[]) {
  const builder = {
    innerJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue(stocks),
  };
  for (const method of [
    'innerJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
  ] as const) {
    builder[method].mockReturnValue(builder);
  }
  return builder;
}

describe('StockQueryService', () => {
  it('TC2: GET stock faqat joriy sotuvchining shopId si bilan filtrlanadi', async () => {
    const stock = {
      variantId: '88',
      warehouseId: '3',
      warehouse: { name: 'Asosiy ombor' },
      quantityOnHand: 10,
      quantityReserved: 2,
      lowStockThreshold: 3,
    } as Stock;
    const builder = queryBuilderWith([stock]);
    const stocks = { createQueryBuilder: jest.fn().mockReturnValue(builder) };
    const catalog = {
      send: jest.fn().mockReturnValue(
        of([
          {
            variantId: '88',
            productId: '12',
            productName: 'Telefon',
            variantName: 'Qora',
            sku: 'PHONE-BLACK',
          },
        ]),
      ),
    };
    const service = new StockQueryService(stocks as never, catalog as never);

    const result = await service.findAll('15', {
      page: 1,
      limit: 20,
      lowOnly: false,
    });

    expect(builder.where).toHaveBeenCalledWith(
      'warehouse.owner_type = :ownerType',
      { ownerType: WarehouseOwnerType.SHOP },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'warehouse.owner_id = :shopId',
      { shopId: '15' },
    );
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'inventory.variant-details' },
      { shopId: '15', variantIds: ['88'] },
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].available).toBe(8);
  });

  it('TC3: /stock/low available thresholddan kichik yoki tenglarni so‘raydi', async () => {
    const stock = {
      variantId: '99',
      warehouseId: '3',
      warehouse: { name: 'Asosiy ombor' },
      quantityOnHand: 7,
      quantityReserved: 3,
      lowStockThreshold: 4,
    } as Stock;
    const builder = queryBuilderWith([stock]);
    const stocks = { createQueryBuilder: jest.fn().mockReturnValue(builder) };
    const catalog = {
      send: jest.fn().mockReturnValue(
        of([
          {
            variantId: '99',
            productId: '13',
            productName: 'Quloqchin',
            variantName: null,
            sku: 'HEADPHONE',
          },
        ]),
      ),
    };
    const service = new StockQueryService(stocks as never, catalog as never);

    const result = await service.findLow('15', {
      page: 1,
      limit: 20,
      lowOnly: false,
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      '(stock.quantity_on_hand - stock.quantity_reserved) <= stock.low_stock_threshold',
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        variantId: '99',
        available: 4,
        lowStockThreshold: 4,
      }),
    );
  });
});
