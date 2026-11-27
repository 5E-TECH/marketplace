import { Controller, Injectable, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import {
  LeadOrderStatus,
  PRODUCT_ARCHIVE_RPC,
  RpcHttpExceptionFilter,
} from '@app/common';
import { ELCHI_CHECK_OPEN_STATUSES } from './elchi-check.controller';

/**
 * BE-25 (FE-25) [taklif]: mahsulotni arxivlashni to‘sadigan «ochiq buyurtma» — omborda (topshirilgunga qadar) va
 * Elchi’da yakuni kelmagan holatlar (kunlik Elchi tekshiruvi bilan bir to‘plam). Pul o‘tkazilgan, hisob-kitob
 * qilingan, bekor qilingan va qaytib saralangan buyurtma to‘smaydi.
 */
export const PRODUCT_OPEN_ORDER_STATUSES: LeadOrderStatus[] = [
  LeadOrderStatus.CONFIRMED,
  LeadOrderStatus.PICKING,
  LeadOrderStatus.PACKED,
  ...ELCHI_CHECK_OPEN_STATUSES,
];

const ID = /^[1-9]\d{0,18}$/;
const MAX_IDS = 500;

@Injectable()
export class ProductOpenOrdersService {
  constructor(private readonly dataSource: DataSource) {}

  /** Mahsulot bo‘yicha ochiq buyurtmalar soni; ochiq buyurtmasi yo‘q mahsulot javobda yo‘q. */
  async count(productIds: unknown): Promise<Record<string, number>> {
    const ids = [
      ...new Set(
        (Array.isArray(productIds) ? productIds : [])
          .map(String)
          .filter((id) => ID.test(id)),
      ),
    ].slice(0, MAX_IDS);
    if (!ids.length) return {};
    const rows = (await this.dataSource.query(
      `SELECT i.product_id::text AS "productId", COUNT(DISTINCT o.id)::int AS count
         FROM checkout.sales_order_item i
         JOIN checkout.parcel p ON p.id = i.sales_order_seller_id
         JOIN checkout.sales_order o ON o.id = p.sales_order_id
        WHERE i.product_id = ANY($1::bigint[]) AND o.status = ANY($2::text[])
        GROUP BY i.product_id`,
      [ids, PRODUCT_OPEN_ORDER_STATUSES],
    )) as Array<{ productId: string; count: number }>;
    return Object.fromEntries(rows.map((r) => [r.productId, Number(r.count)]));
  }
}

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class ProductOpenOrdersController {
  constructor(private readonly orders: ProductOpenOrdersService) {}

  @MessagePattern({ cmd: PRODUCT_ARCHIVE_RPC.OPEN_ORDERS })
  openOrders(@Payload() data: { productIds?: unknown }) {
    return this.orders.count(data?.productIds);
  }
}
