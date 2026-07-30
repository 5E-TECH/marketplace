import { Injectable } from '@nestjs/common';
import {
  SellerDashboardDto,
  SellerOrdersPageDto,
  SellerOrdersQueryDto,
} from '@app/common';
import { DataSource } from 'typeorm';

interface CountRow {
  total: string | number;
}

@Injectable()
export class SellerOrdersService {
  constructor(private readonly dataSource: DataSource) {}

  async findAll(
    shopId: string,
    query: SellerOrdersQueryDto,
  ): Promise<SellerOrdersPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const params: unknown[] = [shopId];
    const conditions = ['s.shop_id = $1'];

    if (query.status) {
      params.push(query.status);
      conditions.push(`s.status = $${params.length}`);
    }
    if (query.dateFrom) {
      params.push(query.dateFrom);
      conditions.push(`s.created_at >= $${params.length}::date`);
    }
    if (query.dateTo) {
      params.push(query.dateTo);
      conditions.push(
        `s.created_at < $${params.length}::date + interval '1 day'`,
      );
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      conditions.push(
        `(s.id::text ILIKE $${params.length} OR s.sales_order_id::text ILIKE $${params.length} OR COALESCE(o.buyer_name, '') ILIKE $${params.length})`,
      );
    }

    const where = conditions.join(' AND ');
    const [countRows] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total
       FROM checkout.sales_order_seller s
       JOIN checkout.sales_order o ON o.id = s.sales_order_id
       WHERE ${where}`,
      params,
    );

    const listParams = [...params, limit, (page - 1) * limit];
    const rows = await this.dataSource.query(
      `SELECT s.id, s.sales_order_id AS "salesOrderId",
              o.buyer_name AS "buyerName", s.subtotal, s.cod_amount AS "codAmount",
              s.status, s.elchi_shipment_id AS "elchiShipmentId",
              s.tracking_url AS "trackingUrl",
              COALESCE(SUM(i.quantity), 0)::int AS "itemsCount",
              s.created_at AS "createdAt"
       FROM checkout.sales_order_seller s
       JOIN checkout.sales_order o ON o.id = s.sales_order_id
       LEFT JOIN checkout.sales_order_item i ON i.sales_order_seller_id = s.id
       WHERE ${where}
       GROUP BY s.id, o.buyer_name
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );
    const total = Number((countRows as CountRow | undefined)?.total ?? 0);

    return {
      items: rows.map((row: Record<string, unknown>) => ({
        ...row,
        subtotal: Number(row.subtotal),
        codAmount: Number(row.codAmount),
        itemsCount: Number(row.itemsCount),
      })) as SellerOrdersPageDto['items'],
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async dashboard(
    shopId: string,
    lowStockCount: number,
  ): Promise<SellerDashboardDto> {
    const [summaryRows, topProducts, salesByDay] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*)::int AS "ordersTotal",
                COALESCE(SUM(subtotal) FILTER (WHERE status = 'DELIVERED'), 0) AS revenue,
                COUNT(*) FILTER (WHERE status IN ('PENDING', 'SHIPMENT_CREATED', 'ON_THE_ROAD'))::int AS "pendingShipments",
                COUNT(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered
         FROM checkout.sales_order_seller WHERE shop_id = $1`,
        [shopId],
      ),
      this.dataSource.query(
        `SELECT i.product_id AS "productId", MAX(i.product_name) AS name,
                SUM(i.quantity)::int AS sold
         FROM checkout.sales_order_item i
         JOIN checkout.sales_order_seller s ON s.id = i.sales_order_seller_id
         WHERE s.shop_id = $1 AND s.status = 'DELIVERED'
         GROUP BY i.product_id ORDER BY sold DESC, i.product_id LIMIT 5`,
        [shopId],
      ),
      this.dataSource.query(
        `SELECT TO_CHAR(s.created_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS date,
                SUM(s.subtotal) AS amount
         FROM checkout.sales_order_seller s
         WHERE s.shop_id = $1 AND s.status = 'DELIVERED'
           AND s.created_at >= CURRENT_DATE - interval '29 days'
         GROUP BY date ORDER BY date`,
        [shopId],
      ),
    ]);
    const summary = summaryRows[0] ?? {};

    return {
      ordersTotal: Number(summary.ordersTotal ?? 0),
      revenue: Number(summary.revenue ?? 0),
      pendingShipments: Number(summary.pendingShipments ?? 0),
      delivered: Number(summary.delivered ?? 0),
      lowStockCount,
      topProducts: topProducts.map((row: Record<string, unknown>) => ({
        productId: String(row.productId),
        name: String(row.name ?? ''),
        sold: Number(row.sold),
      })),
      salesByDay: salesByDay.map((row: Record<string, unknown>) => ({
        date: String(row.date),
        amount: Number(row.amount),
      })),
    };
  }
}
