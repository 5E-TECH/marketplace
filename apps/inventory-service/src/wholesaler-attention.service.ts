import { Controller, Injectable, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import {
  AttentionVariant,
  InboundShipmentStatus,
  InventoryAttentionResult,
  RpcHttpExceptionFilter,
  WHOLESALER_ATTENTION_RPC,
  WholesalerActKind,
} from '@app/common';
import { shipmentNumber } from './inbound.service';
import { InventoryService } from './inventory.service';

const ID = /^[1-9]\d{0,18}$/;
/** Ro‘yxat chegaralari (60 s da yangilanadi; pilot 30–50 SKU) [taklif]. */
const MAX_SHIPMENTS = 200;
const MAX_ACTS = 100;
const MAX_CODES = 20;

/** Lid buyurtmasi raqami — checkout `leadOrderNumber` bilan bir xil (`L-<id>`). */
const orderNumber = (orderRef: string) => `L-${orderRef}`;
/** Brak akti raqami [taklif]: backendda alohida raqam yo‘q — buyurtma bo‘yicha (`BA-000123`). */
export const defectActNumber = (orderRef: string) =>
  `BA-${String(orderRef).padStart(6, '0')}`;

export interface WholesalerActRow {
  id: string;
  kind: WholesalerActKind.DEFECT | WholesalerActKind.RECEIVING;
  code: string;
  title: string;
  at: Date | null;
}

function variantsOf(input: unknown): AttentionVariant[] {
  const list = (input as { variants?: unknown })?.variants;
  return (Array.isArray(list) ? list : []).filter(
    (v: AttentionVariant) =>
      ID.test(String(v?.variantId ?? '')) &&
      ID.test(String(v?.wholesalerId ?? '')),
  ) as AttentionVariant[];
}

/**
 * BE-25 (FE-25): admin optoviklar sahifasi uchun ombor raqamlari — «Diqqat talab qiladi» va optovik aktlari.
 * Optovik variantlari catalog dan (gateway beradi). Hisob optovik paneli (`WholesalerStockService`) va offer qoldig‘i
 * (`InventoryService.available`) bilan bir xil.
 */
@Injectable()
export class WholesalerAttentionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inventory: InventoryService,
  ) {}

  async attention(input: {
    variants: AttentionVariant[];
  }): Promise<InventoryAttentionResult> {
    const variants = variantsOf(input);
    const [defectShipments, outOfStock, defectByWholesaler] = await Promise.all(
      [
        this.defectShipments(),
        this.outOfStock(variants.filter((v) => v.onSale)),
        this.defectsNotReturned(variants),
      ],
    );
    return { defectShipments, outOfStock, defectByWholesaler };
  }

  /** Optovik aktlari: brak akti (qaytganlarni saralash) va qabuldagi farq akti; yangisi tepada. */
  async acts(input: {
    wholesalerId: string;
    variants: AttentionVariant[];
  }): Promise<WholesalerActRow[]> {
    const wholesalerId = String(input?.wholesalerId ?? '');
    if (!ID.test(wholesalerId)) return [];
    const variants = variantsOf(input).filter(
      (v) => String(v.wholesalerId) === wholesalerId,
    );
    const names = new Map(
      variants.map((v) => [String(v.variantId), v.productName]),
    );
    const defects = (await this.dataSource.query(
      `SELECT order_ref::text AS "orderRef", array_agg(variant_id::text ORDER BY variant_id) AS "variantIds",
              SUM(defective_qty)::int AS qty, MAX(inspected_at) AS at
         FROM inventory.return_inspection
        WHERE variant_id = ANY($1::bigint[]) AND defective_qty > 0
        GROUP BY order_ref
        ORDER BY MAX(inspected_at) DESC, order_ref DESC
        LIMIT $2`,
      [[...names.keys()], MAX_ACTS],
    )) as Array<{
      orderRef: string;
      variantIds: string[];
      qty: number;
      at: Date;
    }>;
    const receiving = (await this.dataSource.query(
      `SELECT s.id::text AS id, s.received_at AS at,
              (SELECT i.product_name FROM inventory.inbound_shipment_item i
                WHERE i.shipment_id = s.id ORDER BY i.id LIMIT 1) AS "productName",
              COUNT(i.id)::int AS lines,
              COALESCE(SUM(GREATEST(i.declared_qty - COALESCE(i.received_qty, 0), 0)), 0)::int AS short,
              COALESCE(SUM(GREATEST(COALESCE(i.received_qty, 0) - i.declared_qty, 0)), 0)::int AS surplus,
              COALESCE(SUM(COALESCE(i.defective_qty, 0)), 0)::int AS defect
         FROM inventory.inbound_shipment s
         JOIN inventory.inbound_shipment_item i ON i.shipment_id = s.id
        WHERE s.wholesaler_id = $1 AND s.status = $2
        GROUP BY s.id
        ORDER BY s.received_at DESC, s.id DESC
        LIMIT $3`,
      [wholesalerId, InboundShipmentStatus.DISCREPANCY, MAX_ACTS],
    )) as Array<{
      id: string;
      at: Date;
      productName: string;
      lines: number;
      short: number;
      surplus: number;
      defect: number;
    }>;
    return [
      ...defects.map((row) => {
        const code = defectActNumber(row.orderRef);
        const products = [
          ...new Set(
            row.variantIds.map((id) => names.get(String(id)) ?? `#${id}`),
          ),
        ].join(', ');
        return {
          id: code,
          kind: WholesalerActKind.DEFECT as const,
          code,
          title: `${products} · ${row.qty} dona · ${orderNumber(row.orderRef)}`,
          at: row.at,
        };
      }),
      ...receiving.map((row) => {
        const code = shipmentNumber(row.id);
        const parts = [
          row.short ? `${row.short} kam` : '',
          row.surplus ? `${row.surplus} ortiq` : '',
          row.defect ? `${row.defect} brak` : '',
        ].filter(Boolean);
        const more = row.lines > 1 ? ` va yana ${row.lines - 1}` : '';
        return {
          id: code,
          kind: WholesalerActKind.RECEIVING as const,
          code,
          title: `${row.productName}${more} · farq: ${parts.join(', ') || '—'}`,
          at: row.at,
        };
      }),
    ];
  }

  /** Qabulda farq chiqqan postavkalar (DISCREPANCY — yakuniy holat, «hal qilindi» yo‘q). */
  private async defectShipments(): Promise<
    InventoryAttentionResult['defectShipments']
  > {
    const rows = (await this.dataSource.query(
      `SELECT s.id::text AS "shipmentId", s.wholesaler_id::text AS "wholesalerId",
              (SELECT i.product_name FROM inventory.inbound_shipment_item i
                WHERE i.shipment_id = s.id ORDER BY i.id LIMIT 1) AS "productName",
              SUM(i.declared_qty)::int AS declared,
              COALESCE(SUM(i.received_qty), 0)::int AS received,
              COALESCE(SUM(i.defective_qty), 0)::int AS defect
         FROM inventory.inbound_shipment s
         JOIN inventory.inbound_shipment_item i ON i.shipment_id = s.id
        WHERE s.status = $1
        GROUP BY s.id
        ORDER BY s.received_at DESC, s.id DESC
        LIMIT $2`,
      [InboundShipmentStatus.DISCREPANCY, MAX_SHIPMENTS],
    )) as Array<
      Omit<InventoryAttentionResult['defectShipments'][number], 'code'>
    >;
    return rows.map((row) => ({
      ...row,
      code: shipmentNumber(row.shipmentId),
    }));
  }

  /**
   * Sotuvdagi mahsulotning sotsa bo‘ladigan qoldig‘i 0 (offer qoldig‘i bilan bir hisob: omborda − band − muddati
   * sabab to‘silgan partiya). Kelayotgani — eng yaqin e’lon qilingan yoki yo‘ldagi postavka.
   */
  private async outOfStock(
    variants: AttentionVariant[],
  ): Promise<InventoryAttentionResult['outOfStock']> {
    if (!variants.length) return [];
    const ids = variants.map((v) => String(v.variantId));
    const [available, warehouseId] = await Promise.all([
      this.inventory.available(ids),
      this.inventory.hqWarehouseId(),
    ]);
    const empty = variants.filter((v) => !available[String(v.variantId)]);
    if (!empty.length) return [];
    const emptyIds = empty.map((v) => String(v.variantId));
    const [stock, incoming] = await Promise.all([
      this.dataSource.query(
        `SELECT variant_id::text AS "variantId", quantity_on_hand AS "onHand", quantity_reserved AS reserved
           FROM inventory.stock WHERE variant_id = ANY($1::bigint[]) AND warehouse_id = $2`,
        [emptyIds, warehouseId],
      ) as Promise<
        Array<{ variantId: string; onHand: number; reserved: number }>
      >,
      this.dataSource.query(
        `SELECT DISTINCT ON (i.variant_id) i.variant_id::text AS "variantId", s.id::text AS "shipmentId",
                i.declared_qty AS qty
           FROM inventory.inbound_shipment_item i
           JOIN inventory.inbound_shipment s ON s.id = i.shipment_id
          WHERE i.variant_id = ANY($1::bigint[]) AND s.status = ANY($2::text[])
          ORDER BY i.variant_id, s.expected_at, s.id`,
        [
          emptyIds,
          [InboundShipmentStatus.DECLARED, InboundShipmentStatus.IN_TRANSIT],
        ],
      ) as Promise<
        Array<{ variantId: string; shipmentId: string; qty: number }>
      >,
    ]);
    const stockOf = new Map(stock.map((row) => [row.variantId, row]));
    const incomingOf = new Map(incoming.map((row) => [row.variantId, row]));
    const seen = new Set<string>();
    const result: InventoryAttentionResult['outOfStock'] = [];
    for (const v of empty) {
      const productId = String(v.productId);
      if (seen.has(productId)) continue;
      seen.add(productId);
      const row = stockOf.get(String(v.variantId));
      const next = incomingOf.get(String(v.variantId));
      result.push({
        productId,
        onHand: Number(row?.onHand ?? 0),
        reserved: Number(row?.reserved ?? 0),
        incomingCode: next ? shipmentNumber(next.shipmentId) : null,
        incomingQty: next ? Number(next.qty) : 0,
      });
    }
    return result;
  }

  /**
   * Optovikka qaytarilmagan brak: qabuldagi brak (postavka qatorlari) va qaytgan tovarni saralashdagi brak.
   * Brakni optovikka qaytarish operatsiyasi hali yo‘q (`RETURN_TO_SUPPLIER` yozilmaydi) — son faqat o‘sadi (ega savoli).
   */
  private async defectsNotReturned(
    variants: AttentionVariant[],
  ): Promise<InventoryAttentionResult['defectByWholesaler']> {
    const owner = new Map(
      variants.map((v) => [String(v.variantId), String(v.wholesalerId)]),
    );
    const [receiving, returns] = await Promise.all([
      this.dataSource.query(
        `SELECT s.wholesaler_id::text AS "wholesalerId", s.id::text AS "shipmentId",
                SUM(i.defective_qty)::int AS qty
           FROM inventory.inbound_shipment s
           JOIN inventory.inbound_shipment_item i ON i.shipment_id = s.id
          WHERE i.defective_qty > 0
          GROUP BY s.wholesaler_id, s.id
          ORDER BY s.id DESC`,
      ) as Promise<
        Array<{ wholesalerId: string; shipmentId: string; qty: number }>
      >,
      owner.size
        ? (this.dataSource.query(
            `SELECT order_ref::text AS "orderRef", variant_id::text AS "variantId", defective_qty AS qty
               FROM inventory.return_inspection
              WHERE defective_qty > 0 AND variant_id = ANY($1::bigint[])
              ORDER BY order_ref DESC`,
            [[...owner.keys()]],
          ) as Promise<
            Array<{ orderRef: string; variantId: string; qty: number }>
          >)
        : Promise.resolve([]),
    ]);
    const byWholesaler = new Map<
      string,
      InventoryAttentionResult['defectByWholesaler'][number]
    >();
    const entry = (wholesalerId: string) => {
      let row = byWholesaler.get(wholesalerId);
      if (!row) {
        row = {
          wholesalerId,
          quantity: 0,
          fromReceiving: 0,
          receivingCodes: [],
          fromReturns: 0,
          returnCodes: [],
        };
        byWholesaler.set(wholesalerId, row);
      }
      return row;
    };
    for (const r of receiving) {
      const row = entry(r.wholesalerId);
      row.fromReceiving += Number(r.qty);
      if (row.receivingCodes.length < MAX_CODES)
        row.receivingCodes.push(shipmentNumber(r.shipmentId));
    }
    for (const r of returns) {
      const wholesalerId = owner.get(String(r.variantId));
      if (!wholesalerId) continue;
      const row = entry(wholesalerId);
      row.fromReturns += Number(r.qty);
      const code = orderNumber(r.orderRef);
      if (row.returnCodes.length < MAX_CODES && !row.returnCodes.includes(code))
        row.returnCodes.push(code);
    }
    return [...byWholesaler.values()]
      .map((row) => ({ ...row, quantity: row.fromReceiving + row.fromReturns }))
      .filter((row) => row.quantity > 0);
  }
}

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class WholesalerAttentionController {
  constructor(private readonly svc: WholesalerAttentionService) {}

  @MessagePattern({ cmd: WHOLESALER_ATTENTION_RPC.INVENTORY_ATTENTION })
  attention(@Payload() data: { variants: AttentionVariant[] }) {
    return this.svc.attention(data);
  }

  @MessagePattern({ cmd: WHOLESALER_ATTENTION_RPC.INVENTORY_ACTS })
  acts(
    @Payload() data: { wholesalerId: string; variants: AttentionVariant[] },
  ) {
    return this.svc.acts(data);
  }
}
