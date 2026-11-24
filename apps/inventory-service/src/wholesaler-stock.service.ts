import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  InboundShipmentStatus,
  StockMovementType,
  WholesalerSoldUnit,
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
 * yo‘lda — e’lon qilingan, hali qabul qilinmagan postavka; qaytgan — RETURN, brak — qabuldagi brak va qaytganlarni
 * saralashdagi DEFECT. Optovik variantlari catalog dan (gateway beradi).
 *
 * Sotilgan — moliya hisobidan (gateway `finance.wholesaler.sold-units` dan beradi): yetkazilgan va teskari yozilmagan
 * dona — OPT-3 «raqamlar ombor va moliya hisobi bilan mos». COMMIT (Elchi’ga topshirish) sotuv emas: posilka qaytishi
 * mumkin. Topshirilgan, lekin hali sotilmagan va qaytib saralanmagan dona — «mijozga yo‘lda» (TZ manbasi: «sotuvga
 * chiqib taqdiri hali aniq emas») [taklif].
 */
@Injectable()
export class WholesalerStockService {
  constructor(private readonly dataSource: DataSource) {}

  async summary(input: {
    wholesalerId: string;
    variants: VariantRef[];
    /** Moliyadagi sotilgan dona, mahsulot bo‘yicha (berilmasa — 0). */
    sold?: WholesalerSoldUnit[];
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

    const moved = (variantId: string, type: StockMovementType) =>
      moves.find((m) => m.variantId === variantId && m.type === type)?.qty ?? 0;
    // Elchi’ga topshirilgan, hali qaytib saralanmagan dona — sotilgan yoki mijozga yo‘lda
    const shippedNet = (variantId: string) =>
      Math.max(
        0,
        moved(variantId, StockMovementType.COMMIT) -
          moved(variantId, StockMovementType.RETURN) -
          moved(variantId, StockMovementType.DEFECT),
      );
    // Sotilgan — moliyadan, mahsulot bo‘yicha (ledger qatorida variant yo‘q). CPA mahsulotida bitta faol variant (BE-07);
    // bir nechta bo‘lsa, son variantlarga ular topshirgan (qaytmagan) dona bo‘yicha taqsimlanadi, qoldig‘i — eng ko‘p
    // topshirganiga: mahsulot jami ham, har variantning «mijozga yo‘lda» si ham to‘g‘ri qoladi.
    const soldByProduct = new Map<string, number>();
    for (const row of input?.sold ?? []) {
      const quantity = Number(row?.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) continue;
      const productId = String(row?.productId ?? '');
      soldByProduct.set(
        productId,
        (soldByProduct.get(productId) ?? 0) + quantity,
      );
    }
    const soldByVariant = new Map<string, number>();
    for (const [productId, total] of soldByProduct) {
      const own = variants
        .filter((v) => String(v.productId) === productId)
        .map((v) => String(v.variantId))
        .sort((a, b) => shippedNet(b) - shippedNet(a) || Number(a) - Number(b));
      if (!own.length) continue;
      let left = total;
      for (const variantId of own) {
        const take = Math.min(left, shippedNet(variantId));
        soldByVariant.set(variantId, take);
        left -= take;
      }
      soldByVariant.set(own[0], (soldByVariant.get(own[0]) ?? 0) + left);
    }
    const items = variants.map<WholesalerStockRowDto>((v) => {
      const variantId = String(v.variantId);
      const own = stock.filter((row) => row.variantId === variantId);
      const onHand = sum(own.map((row) => Number(row.onHand)));
      const reserved = sum(own.map((row) => Number(row.reserved)));
      const receipt = inbound.find((r) => r.variantId === variantId);
      const sold = soldByVariant.get(variantId) ?? 0;
      const returned = moved(variantId, StockMovementType.RETURN);
      const returnedDefective = moved(variantId, StockMovementType.DEFECT);
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
        // Elchi’ga topshirilgan (COMMIT) dona uch holatdan birida: mijozga yo‘lda, sotilgan yoki qaytib saralangan
        outForDelivery: Math.max(0, shippedNet(variantId) - sold),
        sold,
        returned,
        defective: (receipt?.defective ?? 0) + returnedDefective,
      };
    });
    const keys = [
      'onHand',
      'reserved',
      'available',
      'inTransit',
      'outForDelivery',
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
