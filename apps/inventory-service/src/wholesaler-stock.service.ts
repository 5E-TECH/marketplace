import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  InboundShipmentStatus,
  StockMovementType,
  WholesalerStockRowDto,
  WholesalerStockTotals,
} from '@app/common';
import { blockedByVariant } from './stock-lots';

type VariantRef = Pick<
  WholesalerStockRowDto,
  'productId' | 'productName' | 'variantId' | 'sku'
>;

/**
 * BE-30 (OPT-3, TC2): optovik paneli — ombor raqamlari inventory jadvallarining o‘zidan (admin qoldiq ro‘yxati bilan bir
 * xil hisob): omborda va bandda — `stock`; sotuvda bor — omborda − band − muddati sabab to‘silgan partiya (BE-17);
 * yo‘lda — e’lon qilingan, hali qabul qilinmagan postavka; sotilgan — COMMIT (Elchi’ga topshirish), qaytgan — RETURN,
 * brak — qabuldagi brak va qaytganlarni saralashdagi DEFECT. Optovik variantlari catalog dan (gateway beradi).
 */
@Injectable()
export class WholesalerStockService {
  constructor(private readonly dataSource: DataSource) {}

  async summary(input: {
    wholesalerId: string;
    variants: VariantRef[];
  }): Promise<{
    items: WholesalerStockRowDto[];
    totals: WholesalerStockTotals;
  }> {
    const wholesalerId = String(input?.wholesalerId ?? '');
    const variants = (input?.variants ?? []).filter((v) =>
      /^\d+$/.test(String(v?.variantId ?? '')),
    );
    const ids = variants.map((v) => String(v.variantId));
    const stock = (await this.dataSource.query(
      `SELECT variant_id::text AS "variantId", warehouse_id::text AS "warehouseId",
              quantity_on_hand AS "onHand", quantity_reserved AS reserved
         FROM inventory.stock WHERE variant_id = ANY($1::bigint[])`,
      [ids],
    )) as Array<{
      variantId: string;
      warehouseId: string;
      onHand: number;
      reserved: number;
    }>;
    const moves = (await this.dataSource.query(
      `SELECT variant_id::text AS "variantId", type, COALESCE(SUM(ABS(quantity)), 0)::int AS qty
         FROM inventory.stock_movement
        WHERE variant_id = ANY($1::bigint[]) AND type = ANY($2::text[])
        GROUP BY variant_id, type`,
      [
        ids,
        [
          StockMovementType.COMMIT,
          StockMovementType.RETURN,
          StockMovementType.DEFECT,
        ],
      ],
    )) as Array<{ variantId: string; type: StockMovementType; qty: number }>;
    const inbound = (await this.dataSource.query(
      `SELECT i.variant_id::text AS "variantId",
              COALESCE(SUM(i.declared_qty) FILTER (WHERE s.status = ANY($3::text[])), 0)::int AS "inTransit",
              COALESCE(SUM(i.defective_qty), 0)::int AS defective
         FROM inventory.inbound_shipment_item i
         JOIN inventory.inbound_shipment s ON s.id = i.shipment_id
        WHERE s.wholesaler_id = $1 AND i.variant_id = ANY($2::bigint[])
        GROUP BY i.variant_id`,
      [
        wholesalerId,
        ids,
        [InboundShipmentStatus.DECLARED, InboundShipmentStatus.IN_TRANSIT],
      ],
    )) as Array<{ variantId: string; inTransit: number; defective: number }>;

    const blocked = new Map<string, number>();
    for (const warehouseId of new Set(stock.map((row) => row.warehouseId)))
      for (const [variantId, qty] of await blockedByVariant(
        this.dataSource.manager,
        stock
          .filter((row) => row.warehouseId === warehouseId)
          .map((row) => row.variantId),
        warehouseId,
      ))
        blocked.set(variantId, (blocked.get(variantId) ?? 0) + qty);

    const items = variants.map<WholesalerStockRowDto>((v) => {
      const own = stock.filter((row) => row.variantId === String(v.variantId));
      const onHand = sum(own.map((row) => Number(row.onHand)));
      const reserved = sum(own.map((row) => Number(row.reserved)));
      const moved = (type: StockMovementType) =>
        moves.find(
          (m) => m.variantId === String(v.variantId) && m.type === type,
        )?.qty ?? 0;
      const receipt = inbound.find((r) => r.variantId === String(v.variantId));
      return {
        productId: String(v.productId),
        productName: v.productName,
        variantId: String(v.variantId),
        sku: v.sku,
        onHand,
        reserved,
        available: Math.max(
          0,
          onHand - reserved - (blocked.get(String(v.variantId)) ?? 0),
        ),
        inTransit: receipt?.inTransit ?? 0,
        sold: moved(StockMovementType.COMMIT),
        returned: moved(StockMovementType.RETURN),
        defective: (receipt?.defective ?? 0) + moved(StockMovementType.DEFECT),
      };
    });
    const keys = [
      'onHand',
      'reserved',
      'available',
      'inTransit',
      'sold',
      'returned',
      'defective',
    ] as const;
    const totals = Object.fromEntries(
      keys.map((key) => [key, sum(items.map((item) => item[key]))]),
    ) as WholesalerStockTotals;
    return { items, totals };
  }
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
