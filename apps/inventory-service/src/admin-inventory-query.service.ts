import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AdminStockItemDto,
  AdminStockMovementsQueryDto,
  AdminStockQueryDto,
  RmqClient,
  sendRpc,
  WarehouseOwnerType,
} from '@app/common';
import { Repository } from 'typeorm';
import { Stock } from './entities/stock.entity';
import { StockMovement } from './entities/stock-movement.entity';

interface VariantInventoryDetails {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string | null;
  sku: string;
}

@Injectable()
export class AdminInventoryQueryService {
  constructor(
    @InjectRepository(Stock) private readonly stocks: Repository<Stock>,
    @InjectRepository(StockMovement)
    private readonly movements: Repository<StockMovement>,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  async stock(query: AdminStockQueryDto) {
    const builder = this.stocks
      .createQueryBuilder('stock')
      .innerJoinAndSelect('stock.warehouse', 'warehouse')
      .where('warehouse.owner_type = :ownerType', {
        ownerType: WarehouseOwnerType.SHOP,
      })
      .andWhere('warehouse.is_active = TRUE');
    if (query.shopId)
      builder.andWhere('warehouse.owner_id = :shopId', {
        shopId: query.shopId,
      });
    if (query.warehouseId)
      builder.andWhere('stock.warehouse_id = :warehouseId', {
        warehouseId: query.warehouseId,
      });
    if (query.variantId)
      builder.andWhere('stock.variant_id = :variantId', {
        variantId: query.variantId,
      });
    if (query.lowOnly)
      builder.andWhere(
        '(stock.quantity_on_hand - stock.quantity_reserved) <= stock.low_stock_threshold',
      );

    const rows = await builder
      .orderBy('warehouse.owner_id', 'ASC')
      .addOrderBy('stock.updated_at', 'DESC')
      .getMany();
    const grouped = new Map<string, Stock[]>();
    for (const row of rows) {
      grouped.set(row.warehouse.ownerId, [
        ...(grouped.get(row.warehouse.ownerId) ?? []),
        row,
      ]);
    }

    const details = new Map<string, VariantInventoryDetails>();
    await Promise.all(
      [...grouped.entries()].map(async ([shopId, stocks]) => {
        const variants = await sendRpc<VariantInventoryDetails[]>(
          this.catalog,
          { cmd: 'inventory.variant-details' },
          {
            shopId,
            variantIds: [...new Set(stocks.map((row) => row.variantId))],
          },
        );
        for (const variant of variants)
          details.set(`${shopId}:${variant.variantId}`, variant);
      }),
    );

    const search = query.search?.trim().toLocaleLowerCase();
    const items = rows.flatMap<AdminStockItemDto>((row) => {
      const shopId = row.warehouse.ownerId;
      const variant = details.get(`${shopId}:${row.variantId}`);
      if (
        !variant ||
        (query.productId && variant.productId !== query.productId)
      )
        return [];
      if (
        search &&
        ![variant.productName, variant.variantName ?? '', variant.sku].some(
          (value) => value.toLocaleLowerCase().includes(search),
        )
      )
        return [];
      return [
        {
          shopId,
          variantId: row.variantId,
          productName: variant.productName,
          variantName: variant.variantName,
          sku: variant.sku,
          warehouseId: row.warehouseId,
          warehouseName: row.warehouse.name,
          onHand: row.quantityOnHand,
          reserved: row.quantityReserved,
          available: row.quantityOnHand - row.quantityReserved,
          lowStockThreshold: row.lowStockThreshold,
        },
      ];
    });
    return this.page(items, query.page, query.limit);
  }

  async movementList(query: AdminStockMovementsQueryDto) {
    const builder = this.movements
      .createQueryBuilder('movement')
      .innerJoinAndSelect('movement.stock', 'stock')
      .innerJoinAndSelect('stock.warehouse', 'warehouse')
      .where('warehouse.owner_type = :ownerType', {
        ownerType: WarehouseOwnerType.SHOP,
      });
    if (query.shopId)
      builder.andWhere('warehouse.owner_id = :shopId', {
        shopId: query.shopId,
      });
    if (query.warehouseId)
      builder.andWhere('movement.warehouse_id = :warehouseId', {
        warehouseId: query.warehouseId,
      });
    if (query.variantId)
      builder.andWhere('movement.variant_id = :variantId', {
        variantId: query.variantId,
      });
    if (query.type)
      builder.andWhere('movement.type = :type', { type: query.type });
    if (query.dateFrom)
      builder.andWhere('movement.created_at >= :dateFrom', {
        dateFrom: query.dateFrom,
      });
    if (query.dateTo)
      builder.andWhere('movement.created_at <= :dateTo', {
        dateTo: query.dateTo,
      });

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await builder
      .orderBy('movement.createdAt', 'DESC')
      .addOrderBy('movement.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      items: rows.map((row) => ({
        id: row.id,
        shopId: row.stock.warehouse.ownerId,
        variantId: row.variantId,
        warehouseId: row.warehouseId,
        warehouseName: row.stock.warehouse.name,
        type: row.type,
        quantity: row.quantity,
        onHandAfter: row.onHandAfter,
        reservedAfter: row.reservedAfter,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        reason: row.reason,
        actorId: row.actorId,
        createdAt: row.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private page<T>(items: T[], page = 1, limit = 20) {
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
