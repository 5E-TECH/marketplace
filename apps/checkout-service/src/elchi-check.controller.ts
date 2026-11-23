import { Controller, Injectable, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import {
  ELCHI_CHECK_RPC,
  ElchiCheckParcelsResult,
  LeadOrderStatus,
  moneyFromDb,
  RpcHttpExceptionFilter,
} from '@app/common';
import { leadOrderNumber } from './lead-order-status.service';

/** Hali yopilmagan (Elchi’da harakatda yoki pul kutilayotgan) holatlar — har kuni tekshiriladi. */
export const ELCHI_CHECK_OPEN_STATUSES: LeadOrderStatus[] = [
  LeadOrderStatus.HANDED_TO_ELCHI,
  LeadOrderStatus.IN_TRANSIT,
  LeadOrderStatus.DELIVERED,
  LeadOrderStatus.RETURN_REQUESTED,
  LeadOrderStatus.RETURNING,
];

/** Yopilgan buyurtma shuncha kun tekshiruvda qoladi (Elchi keyin o‘zgartirsa ko‘rinadi) [taklif]. */
export const ELCHI_CHECK_RECENT_DAYS = 14;
/** Bir tekshiruvdagi posilkalar chegarasi [taklif] — oshsa `truncated`, qolganlari keyingi kunlarda. */
export const ELCHI_CHECK_MAX_PARCELS = 5_000;

/**
 * BE-46 (TC3, ega 2026-11-24 «Avtomatik so‘rov»): moliyaning kunlik Elchi tekshiruvi uchun posilkalar — Elchi’ga
 * topshirilgan lid buyurtmalari: ochiq holatdagilar hammasi, yopilganlari oxirgi 14 kun ichida o‘zgargan bo‘lsa.
 * Eng eski topshirilgani birinchi (chegara oshsa yangilari keyingi kunga qoladi, eskisi doim tekshiriladi).
 */
@Injectable()
export class ElchiCheckParcelsService {
  constructor(private readonly dataSource: DataSource) {}

  async parcels(input?: { limit?: number }): Promise<ElchiCheckParcelsResult> {
    const limit = Math.min(
      ELCHI_CHECK_MAX_PARCELS,
      Math.max(1, Math.trunc(Number(input?.limit) || ELCHI_CHECK_MAX_PARCELS)),
    );
    const rows = (await this.dataSource.query(
      `SELECT o.id::text AS "orderId", p.elchi_shipment_id::text AS "shipmentId", o.status,
              COALESCE(p.cod_amount, o.cod_amount, 0)::text AS "codAmount"
         FROM checkout.sales_order o
         JOIN checkout.parcel p ON p.sales_order_id = o.id
        WHERE o.source IS NOT NULL
          AND p.elchi_shipment_id IS NOT NULL
          AND p.handed_over_at IS NOT NULL
          AND (o.status = ANY($1::text[]) OR o.updated_at >= now() - make_interval(days => $2))
        ORDER BY p.handed_over_at, o.id
        LIMIT $3`,
      [ELCHI_CHECK_OPEN_STATUSES, ELCHI_CHECK_RECENT_DAYS, limit + 1],
    )) as Array<{
      orderId: string;
      shipmentId: string;
      status: LeadOrderStatus;
      codAmount: string;
    }>;
    return {
      parcels: rows.slice(0, limit).map((row) => ({
        orderId: row.orderId,
        orderNumber: leadOrderNumber(row.orderId),
        shipmentId: row.shipmentId,
        status: row.status,
        codAmount: moneyFromDb(row.codAmount),
      })),
      truncated: rows.length > limit,
    };
  }
}

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class ElchiCheckController {
  constructor(private readonly service: ElchiCheckParcelsService) {}

  @MessagePattern({ cmd: ELCHI_CHECK_RPC.PARCELS })
  parcels(@Payload() input: { limit?: number }) {
    return this.service.parcels(input ?? {});
  }
}
