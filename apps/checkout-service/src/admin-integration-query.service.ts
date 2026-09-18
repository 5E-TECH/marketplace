import { Injectable } from '@nestjs/common';
import { AdminShipmentsQueryDto, AdminWebhooksQueryDto } from '@app/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AdminIntegrationQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async shipments(query: AdminShipmentsQueryDto) {
    const params: unknown[] = [];
    const where = ['s.elchi_shipment_id IS NOT NULL'];
    this.add(where, params, 's.shop_id', query.shopId);
    this.add(where, params, 's.status', query.status);
    this.add(where, params, 's.elchi_shipment_id', query.shipmentId);
    this.add(where, params, 's.created_at', query.dateFrom, '>=');
    this.add(where, params, 's.created_at', query.dateTo, '<=');
    const condition = `WHERE ${where.join(' AND ')}`;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;
    const listParams = [...params, limit, offset];
    const rows = await this.dataSource.query(
      `SELECT s.id::text,
              s.sales_order_id::text AS "salesOrderId",
              s.shop_id::text AS "shopId",
              s.elchi_market_id::text AS "elchiMarketId",
              s.elchi_shipment_id::text AS "shipmentId",
              s.tracking_url AS "trackingUrl",
              s.status,
              s.subtotal::float8,
              s.delivery_fee::float8 AS "deliveryFee",
              s.cod_amount::float8 AS "codAmount",
              o.buyer_name AS "buyerName",
              o.delivery_address AS "deliveryAddress",
              o.where_deliver AS "whereDeliver",
              s.created_at AS "createdAt",
              s.updated_at AS "updatedAt"
         FROM checkout.sales_order_seller s
         JOIN checkout.sales_order o ON o.id=s.sales_order_id
         ${condition}
        ORDER BY s.created_at DESC,s.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams,
    );
    const [count] = await this.dataSource.query(
      `SELECT count(*)::int AS total
         FROM checkout.sales_order_seller s
         ${condition}`,
      params,
    );
    return this.page(rows, Number(count?.total ?? 0), page, limit);
  }

  async webhooks(query: AdminWebhooksQueryDto) {
    const params: unknown[] = [];
    const where = ['TRUE'];
    this.add(where, params, 'event_id', query.eventId);
    this.add(where, params, 'shipment_id', query.shipmentId);
    this.add(where, params, 'sales_order_seller_id', query.sellerOrderId);
    this.add(where, params, 'status', query.status);
    this.add(where, params, 'processed_at', query.dateFrom, '>=');
    this.add(where, params, 'processed_at', query.dateTo, '<=');
    const condition = `WHERE ${where.join(' AND ')}`;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const rows = await this.dataSource.query(
      `SELECT event_id AS "eventId",
              shipment_id::text AS "shipmentId",
              sales_order_seller_id::text AS "sellerOrderId",
              status,occurred_at AS "occurredAt",processed_at AS "processedAt",
              payload
         FROM checkout.elchi_webhook_event
         ${condition}
        ORDER BY processed_at DESC,event_id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    const [count] = await this.dataSource.query(
      `SELECT count(*)::int AS total
         FROM checkout.elchi_webhook_event
         ${condition}`,
      params,
    );
    return this.page(rows, Number(count?.total ?? 0), page, limit);
  }

  private add(
    where: string[],
    params: unknown[],
    column: string,
    value: unknown,
    operator = '=',
  ): void {
    if (value === undefined || value === null || value === '') return;
    params.push(value);
    where.push(`${column} ${operator} $${params.length}`);
  }

  private page(items: unknown[], total: number, page: number, limit: number) {
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
