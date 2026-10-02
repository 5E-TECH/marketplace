import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AdminCatalogWarningDto,
  AdminStockItemDto,
  AdminStockMovementItemDto,
  AdminStockMovementsPageDto,
  AdminStockMovementsQueryDto,
  AdminStockPageDto,
  AdminStockQueryDto,
  RmqClient,
  sendRpc,
  WarehouseOwnerType,
} from '@app/common';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Stock } from './entities/stock.entity';
import { StockMovement } from './entities/stock-movement.entity';

interface VariantInventoryDetails {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string | null;
  sku: string;
}

type VariantInfo = Pick<
  AdminStockItemDto,
  | 'variantId'
  | 'productId'
  | 'productName'
  | 'variantName'
  | 'sku'
  | 'catalogMissing'
>;

@Injectable()
export class AdminInventoryQueryService {
  constructor(
    @InjectRepository(Stock) private readonly stocks: Repository<Stock>,
    @InjectRepository(StockMovement)
    private readonly movements: Repository<StockMovement>,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  /**
   * Butun platforma qoldig'i — SQL darajasida sahifalanadi. Nom/SKU katalogda
   * bo'lgani uchun `search`/`productId` avval katalogda variant id'lariga
   * aylantiriladi; nomlar esa faqat shu sahifa qatorlari uchun so'raladi.
   */
  async stock(query: AdminStockQueryDto): Promise<AdminStockPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    let variantIds: string[] | undefined;
    let searchTruncated = false;
    if (search || query.productId) {
      const found = await sendRpc<{ variantIds: string[]; truncated: boolean }>(
        this.catalog,
        { cmd: 'catalog.admin.variant-search' },
        { search: search || undefined, productId: query.productId },
      );
      if (!found.variantIds.length) {
        return {
          ...this.page([], 0, page, limit),
          warnings: [],
          searchTruncated: false,
        };
      }
      variantIds = found.variantIds;
      searchTruncated = found.truncated;
    }

    const builder = this.stocks
      .createQueryBuilder('stock')
      .innerJoinAndSelect('stock.warehouse', 'warehouse')
      .where('warehouse.owner_type = :ownerType', {
        ownerType: WarehouseOwnerType.SHOP,
      });
    this.warehouseFilters(builder, query);
    if (query.warehouseId)
      builder.andWhere('stock.warehouse_id = :warehouseId', {
        warehouseId: query.warehouseId,
      });
    if (query.variantId)
      builder.andWhere('stock.variant_id = :variantId', {
        variantId: query.variantId,
      });
    if (variantIds)
      builder.andWhere('stock.variant_id IN (:...variantIds)', { variantIds });
    if (query.lowOnly)
      builder.andWhere(
        '(stock.quantity_on_hand - stock.quantity_reserved) <= stock.low_stock_threshold',
      );

    // stock → warehouse ko'pdan-birga: JOIN qatorlarni ko'paytirmaydi, shuning
    // uchun oddiy OFFSET/LIMIT to'g'ri sahifalaydi.
    const [rows, total] = await builder
      .orderBy('warehouse.ownerId', 'ASC')
      .addOrderBy('stock.updatedAt', 'DESC')
      .addOrderBy('stock.id', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();

    const { info, warnings } = await this.variantInfo(
      rows.map((row) => ({
        shopId: row.warehouse.ownerId,
        variantId: row.variantId,
      })),
    );
    const items = rows.map<AdminStockItemDto>((row) => ({
      shopId: row.warehouse.ownerId,
      ...info(row.warehouse.ownerId, row.variantId),
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      warehouseActive: row.warehouse.isActive,
      onHand: row.quantityOnHand,
      reserved: row.quantityReserved,
      available: row.quantityOnHand - row.quantityReserved,
      lowStockThreshold: row.lowStockThreshold,
    }));
    return {
      ...this.page(items, total, page, limit),
      warnings,
      searchTruncated,
    };
  }

  async movementList(
    query: AdminStockMovementsQueryDto,
  ): Promise<AdminStockMovementsPageDto> {
    const builder = this.movements
      .createQueryBuilder('movement')
      .innerJoinAndSelect('movement.stock', 'stock')
      .innerJoinAndSelect('stock.warehouse', 'warehouse')
      .where('warehouse.owner_type = :ownerType', {
        ownerType: WarehouseOwnerType.SHOP,
      });
    this.warehouseFilters(builder, query);
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
    const { info, warnings } = await this.variantInfo(
      rows.map((row) => ({
        shopId: row.stock.warehouse.ownerId,
        variantId: row.variantId,
      })),
    );
    const items = rows.map<AdminStockMovementItemDto>((row) => ({
      id: row.id,
      shopId: row.stock.warehouse.ownerId,
      ...info(row.stock.warehouse.ownerId, row.variantId),
      warehouseId: row.warehouseId,
      warehouseName: row.stock.warehouse.name,
      warehouseActive: row.stock.warehouse.isActive,
      type: row.type,
      quantity: row.quantity,
      onHandAfter: row.onHandAfter,
      reservedAfter: row.reservedAfter,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      reason: row.reason,
      actorId: row.actorId,
      createdAt: row.createdAt,
    }));
    return { ...this.page(items, total, page, limit), warnings };
  }

  /** Qoldiq va harakatlar uchun BIR XIL ombor filtri (do'kon + faollik). */
  private warehouseFilters(
    builder: SelectQueryBuilder<Stock> | SelectQueryBuilder<StockMovement>,
    query: { shopId?: string; warehouseActive?: boolean },
  ): void {
    if (query.shopId)
      builder.andWhere('warehouse.owner_id = :shopId', {
        shopId: query.shopId,
      });
    if (query.warehouseActive !== undefined)
      builder.andWhere('warehouse.is_active = :warehouseActive', {
        warehouseActive: query.warehouseActive,
      });
  }

  /**
   * Sahifa qatorlari uchun katalog ma'lumoti, do'kon bo'yicha bitta RPC.
   *
   * Qatorlar HECH QACHON tushib qolmaydi: avval katalog variantni qaytarmasa
   * qator jimgina yo'qolardi, bitta do'kon katalogi yiqilsa esa butun
   * endpoint yiqilardi (`Promise.all`). Endi yiqilgan do'kon `warnings` da,
   * topilmagan variant esa `catalogMissing: true` bilan qaytadi.
   */
  private async variantInfo(
    rows: Array<{ shopId: string; variantId: string }>,
  ): Promise<{
    info: (shopId: string, variantId: string) => VariantInfo;
    warnings: AdminCatalogWarningDto[];
  }> {
    const byShop = new Map<string, Set<string>>();
    for (const row of rows) {
      const ids = byShop.get(row.shopId) ?? new Set<string>();
      ids.add(row.variantId);
      byShop.set(row.shopId, ids);
    }
    const shops = [...byShop.keys()];
    const results = await Promise.allSettled(
      shops.map((shopId) =>
        sendRpc<VariantInventoryDetails[]>(
          this.catalog,
          { cmd: 'inventory.variant-details' },
          { shopId, variantIds: [...byShop.get(shopId)!] },
        ),
      ),
    );
    const details = new Map<string, VariantInventoryDetails>();
    const failed = new Set<string>();
    const warnings: AdminCatalogWarningDto[] = [];
    results.forEach((result, index) => {
      const shopId = shops[index];
      if (result.status === 'rejected') {
        failed.add(shopId);
        warnings.push({ shopId, reason: this.errorMessage(result.reason) });
        return;
      }
      for (const variant of result.value)
        details.set(`${shopId}:${variant.variantId}`, variant);
    });
    return {
      warnings,
      info: (shopId, variantId) => {
        const variant = details.get(`${shopId}:${variantId}`);
        return {
          variantId,
          productId: variant?.productId ?? null,
          productName: variant?.productName ?? null,
          variantName: variant?.variantName ?? null,
          sku: variant?.sku ?? null,
          // Katalog javob bermagan do'konda "topilmadi" deb bo'lmaydi.
          catalogMissing: !variant && !failed.has(shopId),
        };
      },
    };
  }

  private errorMessage(error: unknown): string {
    const e = error as { message?: unknown } | null;
    return String(e?.message ?? error);
  }

  private page<T>(items: T[], total: number, page: number, limit: number) {
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
