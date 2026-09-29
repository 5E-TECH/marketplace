import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  AdminReturnRequestsQueryDto,
  ReturnRequestDetailsDto,
  ReturnRequestDto,
  ReturnRequestHistoryDto,
  ReturnRequestItemDto,
  ReturnRequestsPageDto,
} from '@app/common';

/** Kim ko'ryapti: xaridor faqat o'zinikini, sotuvchi faqat o'z do'koninikini. */
export interface ReturnViewerScope {
  customerId?: string;
  shopId?: string;
}

export type ReturnListFilter = ReturnViewerScope &
  Partial<AdminReturnRequestsQueryDto>;

const ID_PATTERN = /^[1-9]\d{0,18}$/;

/** bigint ustunga noto'g'ri qiymat SQL xatosiga emas, 404 ga olib kelsin. */
export function assertReturnId(id: string): void {
  if (!ID_PATTERN.test(String(id))) {
    throw new NotFoundException('Qaytarish so‘rovi topilmadi');
  }
}

const SELECT_RETURN = `
  SELECT r.id::text, r.sales_order_id::text AS "orderId",
         r.sales_order_seller_id::text AS "sellerOrderId",
         r.shop_id::text AS "shopId", sh.name AS "shopName",
         o.buyer_name AS "buyerName", r.status, r.reason, r.comment,
         o.payment_method AS "paymentMethod",
         r.requested_amount::float8 AS "requestedAmount",
         r.refunded_amount::float8 AS "refundedAmount", r.restocked,
         r.decision_comment AS "decisionComment", r.decided_at AS "decidedAt",
         r.refunded_at AS "refundedAt", r.created_at AS "createdAt",
         r.updated_at AS "updatedAt"
    FROM checkout.return_request r
    JOIN checkout.sales_order o ON o.id = r.sales_order_id
    LEFT JOIN catalog.shop sh ON sh.id = r.shop_id`;

@Injectable()
export class ReturnRequestQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async list(filter: ReturnListFilter): Promise<ReturnRequestsPageDto> {
    const page = Math.max(1, Number(filter.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(filter.limit ?? 20)));
    const params: unknown[] = [];
    const conditions = ['1 = 1'];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };
    if (filter.customerId) add('r.customer_id = ?', filter.customerId);
    if (filter.shopId) add('r.shop_id = ?', filter.shopId);
    if (filter.status) add('r.status = ?', filter.status);
    if (filter.orderId) add('r.sales_order_id = ?', filter.orderId);
    if (filter.dateFrom) add('r.created_at >= ?::date', filter.dateFrom);
    if (filter.dateTo)
      add(`r.created_at < (?::date + INTERVAL '1 day')`, filter.dateTo);
    const where = conditions.join(' AND ');

    const [count] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM checkout.return_request r WHERE ${where}`,
      params,
    )) as Array<{ total: number }>;
    const rows = (await this.dataSource.query(
      `${SELECT_RETURN}
        WHERE ${where}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    )) as Array<Record<string, unknown>>;
    const total = Number(count?.total ?? 0);
    return {
      items: await this.withItems(this.dataSource.manager, rows),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  /** Scope'dan tashqaridagi so'rov 404 (borligini ham oshkor qilmaymiz). */
  async get(
    id: string,
    scope: ReturnViewerScope = {},
  ): Promise<ReturnRequestDetailsDto> {
    assertReturnId(id);
    const params: unknown[] = [id];
    const conditions = ['r.id = $1'];
    if (scope.customerId) {
      params.push(scope.customerId);
      conditions.push(`r.customer_id = $${params.length}`);
    }
    if (scope.shopId) {
      params.push(scope.shopId);
      conditions.push(`r.shop_id = $${params.length}`);
    }
    const rows = (await this.dataSource.query(
      `${SELECT_RETURN} WHERE ${conditions.join(' AND ')}`,
      params,
    )) as Array<Record<string, unknown>>;
    if (!rows.length)
      throw new NotFoundException('Qaytarish so‘rovi topilmadi');
    const [request] = await this.withItems(this.dataSource.manager, rows);
    const history = (await this.dataSource.query(
      `SELECT from_status AS "fromStatus", to_status AS "toStatus",
              actor_role AS "actorRole", comment, created_at AS "createdAt"
         FROM checkout.return_request_history
        WHERE return_request_id = $1
        ORDER BY id`,
      [id],
    )) as ReturnRequestHistoryDto[];
    return { ...request, history };
  }

  /** Yangi yaratilgan so'rovlar — o'sha tranzaksiya ichida ham o'qiladi. */
  async findMany(
    manager: EntityManager,
    ids: string[],
  ): Promise<ReturnRequestDto[]> {
    if (!ids.length) return [];
    const rows = (await manager.query(
      `${SELECT_RETURN} WHERE r.id = ANY($1::bigint[]) ORDER BY r.id`,
      [ids],
    )) as Array<Record<string, unknown>>;
    return this.withItems(manager, rows);
  }

  private async withItems(
    manager: EntityManager,
    rows: Array<Record<string, unknown>>,
  ): Promise<ReturnRequestDto[]> {
    if (!rows.length) return [];
    const items = (await manager.query(
      `SELECT ri.id::text, ri.return_request_id::text AS "returnRequestId",
              ri.sales_order_item_id::text AS "orderItemId",
              i.product_id::text AS "productId", i.variant_id::text AS "variantId",
              i.product_name AS "productName", p.image_url AS "imageUrl",
              ri.quantity, ri.unit_price::float8 AS "unitPrice",
              ri.line_total::float8 AS "lineTotal"
         FROM checkout.return_request_item ri
         JOIN checkout.sales_order_item i ON i.id = ri.sales_order_item_id
         LEFT JOIN catalog.product p ON p.id = i.product_id
        WHERE ri.return_request_id = ANY($1::bigint[])
        ORDER BY ri.id`,
      [rows.map((row) => String(row.id))],
    )) as Array<Record<string, unknown>>;
    const byRequest = new Map<string, ReturnRequestItemDto[]>();
    for (const item of items) {
      const key = String(item.returnRequestId);
      const list = byRequest.get(key) ?? [];
      list.push({
        id: String(item.id),
        orderItemId: String(item.orderItemId),
        productId: String(item.productId),
        variantId: String(item.variantId),
        productName: String(item.productName ?? ''),
        imageUrl: item.imageUrl ? String(item.imageUrl) : null,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal),
      });
      byRequest.set(key, list);
    }
    return rows.map((row) => this.toDto(row, byRequest.get(String(row.id))));
  }

  private toDto(
    row: Record<string, unknown>,
    items: ReturnRequestItemDto[] = [],
  ): ReturnRequestDto {
    const nullableNumber = (value: unknown) =>
      value === null || value === undefined ? null : Number(value);
    return {
      id: String(row.id),
      orderId: String(row.orderId),
      sellerOrderId: String(row.sellerOrderId),
      shopId: String(row.shopId),
      shopName: (row.shopName as string) ?? null,
      buyerName: (row.buyerName as string) ?? null,
      status: row.status as ReturnRequestDto['status'],
      reason: row.reason as ReturnRequestDto['reason'],
      comment: (row.comment as string) ?? null,
      paymentMethod: String(row.paymentMethod ?? ''),
      requestedAmount: Number(row.requestedAmount),
      refundedAmount: nullableNumber(row.refundedAmount),
      restocked:
        row.restocked === null || row.restocked === undefined
          ? null
          : Boolean(row.restocked),
      decisionComment: (row.decisionComment as string) ?? null,
      decidedAt: (row.decidedAt as Date) ?? null,
      refundedAt: (row.refundedAt as Date) ?? null,
      createdAt: row.createdAt as Date,
      updatedAt: row.updatedAt as Date,
      items,
    };
  }
}
