import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  RmqClient,
  sendRpc,
  StockItemDto,
  StockPageDto,
  StockQueryDto,
  WarehouseOwnerType,
} from '@app/common';
import { Repository } from 'typeorm';
import { Stock } from './entities/stock.entity';

interface VariantInventoryDetails {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string | null;
  sku: string;
}

@Injectable()
export class StockQueryService {
  constructor(
    @InjectRepository(Stock)
    private readonly stocks: Repository<Stock>,
    @Inject(RmqClient.CATALOG)
    private readonly catalog: ClientProxy,
  ) {}

  async findAll(shopId: string, query: StockQueryDto): Promise<StockPageDto> {
    const builder = this.stocks
      .createQueryBuilder('stock')
      .innerJoinAndSelect('stock.warehouse', 'warehouse')
      .where('warehouse.owner_type = :ownerType', {
        ownerType: WarehouseOwnerType.SHOP,
      })
      .andWhere('warehouse.owner_id = :shopId', { shopId })
      .andWhere('warehouse.is_active = TRUE');

    if (query.warehouseId) {
      builder.andWhere('stock.warehouse_id = :warehouseId', {
        warehouseId: query.warehouseId,
      });
    }
    if (query.variantId) {
      builder.andWhere('stock.variant_id = :variantId', {
        variantId: query.variantId,
      });
    }
    if (query.lowOnly) {
      builder.andWhere(
        '(stock.quantity_on_hand - stock.quantity_reserved) <= stock.low_stock_threshold',
      );
    }

    const stocks = await builder
      .orderBy('warehouse.is_default', 'DESC')
      .addOrderBy('stock.updated_at', 'DESC')
      .getMany();

    if (stocks.length === 0) {
      return this.page([], query);
    }

    const variants = await sendRpc<VariantInventoryDetails[]>(
      this.catalog,
      { cmd: 'inventory.variant-details' },
      {
        shopId,
        variantIds: [...new Set(stocks.map((stock) => stock.variantId))],
      },
    );
    const variantsById = new Map(
      variants.map((variant) => [variant.variantId, variant]),
    );
    const search = query.search?.trim().toLocaleLowerCase();

    const items = stocks.flatMap<StockItemDto>((stock) => {
      const variant = variantsById.get(stock.variantId);
      if (
        !variant ||
        (query.productId && variant.productId !== query.productId)
      ) {
        return [];
      }
      if (
        search &&
        ![variant.productName, variant.variantName ?? '', variant.sku].some(
          (value) => value.toLocaleLowerCase().includes(search),
        )
      ) {
        return [];
      }

      return [
        {
          variantId: stock.variantId,
          productName: variant.productName,
          variantName: variant.variantName,
          sku: variant.sku,
          warehouseId: stock.warehouseId,
          warehouseName: stock.warehouse.name,
          onHand: stock.quantityOnHand,
          reserved: stock.quantityReserved,
          available: stock.quantityOnHand - stock.quantityReserved,
          lowStockThreshold: stock.lowStockThreshold,
        },
      ];
    });

    return this.page(items, query);
  }

  findLow(shopId: string, query: StockQueryDto): Promise<StockPageDto> {
    return this.findAll(shopId, { ...query, lowOnly: true });
  }

  private page(items: StockItemDto[], query: StockQueryDto): StockPageDto {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const total = items.length;
    const start = (page - 1) * limit;
    return {
      items: items.slice(start, start + limit),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
