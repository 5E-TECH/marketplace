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
import { blockedByVariant } from './stock-lots';

interface VariantInventoryDetails {
  /** BE-16: mahsulot optovigi (qoldiq egasi). */
  wholesalerId: string;
  wholesalerName: string | null;
  variantId: string;
  productId: string;
  productName: string;
  variantName: string | null;
  sku: string;
  barcode: string | null;
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
    // BE-16: bitta HQ ombor — optovik (shopId) bo‘yicha filtr mahsulot egaligi orqali (katalog)
    if (search || query.productId || query.shopId) {
      const found = await sendRpc<{ variantIds: string[]; truncated: boolean }>(
        this.catalog,
        { cmd: 'catalog.admin.variant-search' },
        {
          search: search || undefined,
          productId: query.productId,
          wholesalerId: query.shopId,
        },
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
        ownerType: WarehouseOwnerType.HQ,
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
      .orderBy('stock.updatedAt', 'DESC')
      .addOrderBy('stock.id', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();

    const { info, warnings } = await this.variantInfo(
      rows.map((row) => row.variantId),
    );
    // BE-17 (OMB-3): sotuvdan chiqqan partiyalar — ombor bo‘yicha
    const blocked = new Map<string, number>();
    for (const warehouseId of new Set(
      rows.map((row) => String(row.warehouseId)),
    ))
      for (const [variantId, quantity] of await blockedByVariant(
        this.stocks.manager,
        rows
          .filter((row) => String(row.warehouseId) === warehouseId)
          .map((row) => String(row.variantId)),
        warehouseId,
      ))
        blocked.set(`${warehouseId}:${variantId}`, quantity);
    const items = rows.map<AdminStockItemDto>((row) => {
      const lotBlocked =
        blocked.get(`${row.warehouseId}:${row.variantId}`) ?? 0;
      return {
        ...info(row.variantId),
        warehouseId: row.warehouseId,
        warehouseName: row.warehouse.name,
        warehouseActive: row.warehouse.isActive,
        onHand: row.quantityOnHand,
        reserved: row.quantityReserved,
        available: Math.max(
          0,
          row.quantityOnHand - row.quantityReserved - lotBlocked,
        ),
        lowStockThreshold: row.lowStockThreshold,
        cell: row.cell ?? null,
        blocked: lotBlocked,
      };
    });
    return {
      ...this.page(items, total, page, limit),
      warnings,
      searchTruncated,
    };
  }

  async movementList(
    query: AdminStockMovementsQueryDto,
  ): Promise<AdminStockMovementsPageDto> {
    let variantIds: string[] | undefined;
    if (query.shopId) {
      const found = await sendRpc<{ variantIds: string[] }>(
        this.catalog,
        { cmd: 'catalog.admin.variant-search' },
        { wholesalerId: query.shopId },
      );
      if (!found.variantIds.length)
        return {
          ...this.page([], 0, query.page ?? 1, query.limit ?? 20),
          warnings: [],
        };
      variantIds = found.variantIds;
    }
    const builder = this.movements
      .createQueryBuilder('movement')
      .innerJoinAndSelect('movement.stock', 'stock')
      .innerJoinAndSelect('stock.warehouse', 'warehouse')
      .where('warehouse.owner_type = :ownerType', {
        ownerType: WarehouseOwnerType.HQ,
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
    if (variantIds)
      builder.andWhere('movement.variant_id IN (:...variantIds)', {
        variantIds,
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
      rows.map((row) => row.variantId),
    );
    const items = rows.map<AdminStockMovementItemDto>((row) => ({
      id: row.id,
      ...info(row.variantId),
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

  /** Qoldiq va harakatlar uchun bir xil ombor filtri (faollik). Optovik filtri — katalog orqali (BE-16). */
  private warehouseFilters(
    builder: SelectQueryBuilder<Stock> | SelectQueryBuilder<StockMovement>,
    query: { warehouseActive?: boolean },
  ): void {
    if (query.warehouseActive !== undefined)
      builder.andWhere('warehouse.is_active = :warehouseActive', {
        warehouseActive: query.warehouseActive,
      });
  }

  /**
   * Sahifa qatorlari uchun katalog ma’lumoti bitta RPC bilan; optovik (`shopId`) — mahsulot egasi (BE-16: ombor
   * bitta). Qator tushib qolmaydi: katalog javob bermasa — `warnings`, variant topilmasa — `catalogMissing: true`.
   */
  private async variantInfo(variantIds: string[]): Promise<{
    info: (variantId: string) => VariantInfo & {
      shopId: string | null;
      shopName: string | null;
      barcode: string | null;
    };
    warnings: AdminCatalogWarningDto[];
  }> {
    const details = new Map<string, VariantInventoryDetails>();
    const warnings: AdminCatalogWarningDto[] = [];
    let failed = false;
    const ids = [...new Set(variantIds)];
    if (ids.length)
      try {
        const rows = await sendRpc<VariantInventoryDetails[]>(
          this.catalog,
          { cmd: 'inventory.variant-details' },
          { variantIds: ids },
        );
        for (const variant of rows)
          details.set(String(variant.variantId), variant);
      } catch (error) {
        failed = true;
        warnings.push({ shopId: null, reason: this.errorMessage(error) });
      }
    return {
      warnings,
      info: (variantId) => {
        const variant = details.get(String(variantId));
        return {
          shopId: variant?.wholesalerId ?? null,
          shopName: variant?.wholesalerName ?? null,
          barcode: variant?.barcode ?? null,
          variantId,
          productId: variant?.productId ?? null,
          productName: variant?.productName ?? null,
          variantName: variant?.variantName ?? null,
          sku: variant?.sku ?? null,
          // Katalog javob bermaganda "topilmadi" deb bo‘lmaydi.
          catalogMissing: !variant && !failed,
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
