import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CheckoutPaymentMethod,
  FinanceRefundRequestedEvent,
  RefundPaymentDto,
  ReturnOrderItemsDto,
  SellerDashboardDto,
  SellerOrdersPageDto,
  SellerOrdersQueryDto,
} from '@app/common';
import { DataSource } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { RmqClient, sendRpc } from '@app/common';
import { firstValueFrom } from 'rxjs';

interface CountRow {
  total: string | number;
}

@Injectable()
export class SellerOrdersService {
  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    @Inject(RmqClient.INTEGRATION)
    private readonly integration?: ClientProxy,
    @Optional()
    @Inject(RmqClient.IDENTITY)
    private readonly identity?: ClientProxy,
    @Optional()
    @Inject(RmqClient.INVENTORY)
    private readonly inventory?: ClientProxy,
    @Optional()
    @Inject(RmqClient.PAYMENT)
    private readonly payment?: ClientProxy,
    @Optional()
    @Inject(RmqClient.FINANCE)
    private readonly finance?: ClientProxy,
    @Optional()
    @Inject(RmqClient.NOTIFICATION)
    private readonly notifications?: ClientProxy,
    @Optional()
    @Inject(RmqClient.CATALOG)
    private readonly catalog?: ClientProxy,
  ) {}

  async findAll(
    shopId: string,
    query: SellerOrdersQueryDto,
    shipmentOnly = false,
  ): Promise<SellerOrdersPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const params: unknown[] = [shopId];
    const conditions = ['s.shop_id = $1'];
    if (shipmentOnly) conditions.push('s.elchi_shipment_id IS NOT NULL');

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
              o.buyer_name AS "buyerName", s.subtotal,
              s.delivery_fee AS "deliveryFee", s.cod_amount AS "codAmount",
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
        deliveryFee: Number(row.deliveryFee),
        codAmount: Number(row.codAmount),
        itemsCount: Number(row.itemsCount),
      })) as SellerOrdersPageDto['items'],
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async countByShop(shopId: string): Promise<number> {
    const rows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total
       FROM checkout.sales_order_seller
       WHERE shop_id = $1`,
      [shopId],
    );
    return Number((rows[0] as CountRow | undefined)?.total ?? 0);
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

  /**
   * C1.28 — platforma darajasidagi buyurtma statistikasi (admin dashboard).
   * `sales_order` (do'kon bo'yicha emas, butun platforma). GMV = tasdiqlangan
   * buyurtmalar (`CONFIRMED`+) `total_amount` yig'indisi. "Bugun" — Asia/Tashkent
   * kuni bo'yicha (bitta AT TIME ZONE konversiyasi). Yangi platformada hamma 0.
   * Daromad C6.2 platforma sozlamasidagi komissiya foizi bilan hisoblanadi.
   * Identity client berilmagan unit-testlarda eski env fallback saqlanadi.
   */
  async adminStats(): Promise<{
    ordersTotal: number;
    ordersToday: number;
    gmv: number;
    revenue: number;
  }> {
    const [rows, settings] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*)::int AS "ordersTotal",
              COUNT(*) FILTER (
                WHERE (created_at AT TIME ZONE 'Asia/Tashkent')::date
                      = (now() AT TIME ZONE 'Asia/Tashkent')::date
              )::int AS "ordersToday",
              COALESCE(
                SUM(total_amount) FILTER (
                  WHERE status IN ('CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED')
                ), 0
              ) AS gmv
         FROM checkout.sales_order`,
      ),
      this.identity
        ? sendRpc<{ commissionPercent: number }>(
            this.identity,
            { cmd: 'identity.settings.get' },
            {},
          )
        : Promise.resolve(null),
    ]);
    const row = rows[0] ?? {};
    const gmv = Number(row.gmv ?? 0);
    const rate = settings
      ? Number(settings.commissionPercent) / 100
      : Number(process.env.PLATFORM_COMMISSION_RATE ?? 0);
    const revenue = Math.round(gmv * (Number.isFinite(rate) ? rate : 0));
    return {
      ordersTotal: Number(row.ordersTotal ?? 0),
      ordersToday: Number(row.ordersToday ?? 0),
      gmv,
      revenue,
    };
  }

  /**
   * C1.30 — admin: butun platformadagi buyurtmalar (sales_order) ro'yxati.
   * Filtr: status / to'lov usuli / do'kon (sub-order bor bo'lsa) / sana. Faqat
   * o'qish. Do'kon filtri EXISTS orqali (bitta order ko'p do'konli bo'lishi mumkin).
   */
  async adminListOrders(query: {
    status?: string;
    paymentMethod?: string;
    shopId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(query?.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query?.limit ?? 20)));

    const params: unknown[] = [];
    const conditions: string[] = ['1 = 1'];
    if (query?.status) {
      params.push(query.status);
      conditions.push(`so.status = $${params.length}`);
    }
    if (query?.paymentMethod) {
      params.push(query.paymentMethod);
      conditions.push(`so.payment_method = $${params.length}`);
    }
    if (query?.shopId) {
      params.push(query.shopId);
      conditions.push(
        `EXISTS (SELECT 1 FROM checkout.sales_order_seller x
                 WHERE x.sales_order_id = so.id AND x.shop_id = $${params.length})`,
      );
    }
    if (query?.dateFrom) {
      params.push(query.dateFrom);
      conditions.push(`so.created_at >= $${params.length}::date`);
    }
    if (query?.dateTo) {
      params.push(query.dateTo);
      conditions.push(
        `so.created_at < ($${params.length}::date + INTERVAL '1 day')`,
      );
    }
    const where = conditions.join(' AND ');

    const countRows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM checkout.sales_order so WHERE ${where}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const listParams = [...params, limit, (page - 1) * limit];
    const rows = await this.dataSource.query(
      `SELECT so.id,
              so.buyer_name AS "buyerName",
              so.status,
              so.payment_method AS "paymentMethod",
              so.total_amount AS "totalAmount",
              so.delivery_fee AS "deliveryFee",
              so.created_at AS "createdAt",
              (SELECT COUNT(*)::int FROM checkout.sales_order_seller s
                 WHERE s.sales_order_id = so.id) AS "sellersCount"
         FROM checkout.sales_order so
        WHERE ${where}
        ORDER BY so.created_at DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    return {
      items: rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        buyerName: (r.buyerName as string) ?? null,
        status: r.status,
        paymentMethod: r.paymentMethod,
        totalAmount: Number(r.totalAmount),
        deliveryFee: Number(r.deliveryFee),
        sellersCount: Number(r.sellersCount),
        createdAt: r.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * C1.30 — admin: bitta buyurtma to'liq (drill-in): sub-buyurtmalar
   * (do'kon bo'yicha) + itemlar + shipment (elchi id/tracking) + to'lov usuli.
   * Topilmasa 404.
   */
  async adminGetOrder(orderId: string) {
    const orderRows = await this.dataSource.query(
      `SELECT so.id,
              so.buyer_name AS "buyerName",
              so.customer_id AS "customerId",
              so.status,
              so.payment_method AS "paymentMethod",
              so.total_amount AS "totalAmount",
              so.delivery_fee AS "deliveryFee",
              so.delivery_address AS "deliveryAddress",
              so.created_at AS "createdAt",
              so.updated_at AS "updatedAt"
         FROM checkout.sales_order so WHERE so.id = $1`,
      [orderId],
    );
    const order = orderRows[0];
    if (!order) {
      throw new NotFoundException(`Buyurtma #${orderId} topilmadi`);
    }

    const [sellers, items] = await Promise.all([
      this.dataSource.query(
        `SELECT sos.id,
                sos.shop_id AS "shopId",
                sos.subtotal,
                sos.delivery_fee AS "deliveryFee",
                sos.cod_amount AS "codAmount",
                sos.status,
                sos.elchi_shipment_id AS "elchiShipmentId",
                sos.tracking_url AS "trackingUrl"
           FROM checkout.sales_order_seller sos
          WHERE sos.sales_order_id = $1 ORDER BY sos.id`,
        [orderId],
      ),
      this.dataSource.query(
        `SELECT i.sales_order_seller_id AS "sellerOrderId",
                i.product_id AS "productId",
                i.product_name AS "productName",
                i.variant_id AS "variantId",
                i.quantity,
                i.unit_price AS "unitPrice",
                i.line_total AS "lineTotal"
           FROM checkout.sales_order_item i
           JOIN checkout.sales_order_seller sos ON sos.id = i.sales_order_seller_id
          WHERE sos.sales_order_id = $1 ORDER BY i.id`,
        [orderId],
      ),
    ]);

    const itemsBySeller = new Map<string, Record<string, unknown>[]>();
    for (const it of items as Record<string, unknown>[]) {
      const key = String(it.sellerOrderId);
      const list = itemsBySeller.get(key) ?? [];
      list.push({
        productId: String(it.productId),
        productName: it.productName,
        variantId: String(it.variantId),
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        lineTotal: Number(it.lineTotal),
      });
      itemsBySeller.set(key, list);
    }

    return {
      id: String(order.id),
      buyerName: order.buyerName ?? null,
      customerId: String(order.customerId),
      status: order.status,
      paymentMethod: order.paymentMethod,
      totalAmount: Number(order.totalAmount),
      deliveryFee: Number(order.deliveryFee),
      deliveryAddress: order.deliveryAddress ?? null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      sellerOrders: (sellers as Record<string, unknown>[]).map((s) => ({
        id: String(s.id),
        shopId: String(s.shopId),
        subtotal: Number(s.subtotal),
        deliveryFee: Number(s.deliveryFee),
        codAmount: Number(s.codAmount),
        status: s.status,
        elchiShipmentId: s.elchiShipmentId ? String(s.elchiShipmentId) : null,
        trackingUrl: (s.trackingUrl as string) ?? null,
        items: itemsBySeller.get(String(s.id)) ?? [],
      })),
    };
  }

  async adminCancelOrder(input: {
    orderId: string;
    reason: string;
    actorId: string;
  }) {
    if (!this.inventory)
      throw new BadRequestException('Inventory servisi ulanmagan');
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `admin-cancel:${input.orderId}`,
      ]);
      const [order] = await manager.query(
        `SELECT id::text,status,payment_method,customer_id::text FROM checkout.sales_order WHERE id=$1 FOR UPDATE`,
        [input.orderId],
      );
      if (!order)
        throw new NotFoundException(`Buyurtma #${input.orderId} topilmadi`);
      if (order.status === 'CANCELLED')
        return {
          id: input.orderId,
          status: 'CANCELLED',
          idempotent: true,
          customerId: order.customer_id,
          shopIds: [] as string[],
        };
      if (!['DRAFT', 'PENDING_PAYMENT'].includes(order.status)) {
        throw new BadRequestException(
          'Bu buyurtmani cancel qilish mumkin emas; to‘langan order uchun refund ishlating',
        );
      }
      await sendRpc(
        this.inventory!,
        { cmd: 'inventory.release' },
        {
          orderRef: input.orderId,
          idempotencyKey: `admin-cancel:${input.orderId}`,
          reason: input.reason,
          actorId: input.actorId,
        },
      );
      const sellers = (await manager.query(
        `SELECT shop_id::text FROM checkout.sales_order_seller WHERE sales_order_id=$1`,
        [input.orderId],
      )) as Array<{ shop_id: string }>;
      await manager.query(
        `UPDATE checkout.sales_order SET status='CANCELLED',updated_at=now() WHERE id=$1`,
        [input.orderId],
      );
      await manager.query(
        `UPDATE checkout.sales_order_seller SET status='CANCELLED',updated_at=now() WHERE sales_order_id=$1`,
        [input.orderId],
      );
      await manager.query(
        `INSERT INTO checkout.sales_order_seller_history (sales_order_seller_id,status,comment)
         SELECT id,'CANCELLED',$2 FROM checkout.sales_order_seller WHERE sales_order_id=$1`,
        [input.orderId, `Admin: ${input.reason}`],
      );
      return {
        id: input.orderId,
        status: 'CANCELLED',
        idempotent: false,
        customerId: order.customer_id,
        shopIds: sellers.map((seller) => seller.shop_id),
      };
    });
    if (result.shopIds.length > 0) {
      await this.notify(
        'order.cancelled',
        result.customerId,
        result.shopIds,
        input.orderId,
        input.reason,
      );
    }
    const { customerId: _customerId, shopIds: _shopIds, ...response } = result;
    return response;
  }

  async adminRefundOrder(input: {
    orderId: string;
    reason: string;
    amount?: number;
    actorId: string;
  }) {
    if (!this.inventory || !this.payment || !this.finance) {
      throw new BadRequestException('Refund servislaridan biri ulanmagan');
    }
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `admin-refund:${input.orderId}`,
      ]);
      const [order] = await manager.query(
        `SELECT id::text,status,payment_method,payment_id::text,total_amount::float8,customer_id::text FROM checkout.sales_order WHERE id=$1 FOR UPDATE`,
        [input.orderId],
      );
      if (!order)
        throw new NotFoundException(`Buyurtma #${input.orderId} topilmadi`);
      if (order.status === 'REFUNDED')
        return {
          id: input.orderId,
          status: 'REFUNDED',
          idempotent: true,
          customerId: order.customer_id,
          shopIds: [] as string[],
        };
      if (order.payment_method === CheckoutPaymentMethod.COD) {
        throw new BadRequestException(
          'To‘lanmagan COD buyurtmani refund qilib bo‘lmaydi',
        );
      }
      if (
        input.amount !== undefined &&
        Number(input.amount) !== Number(order.total_amount)
      ) {
        throw new BadRequestException(
          'Hozir faqat to‘liq refund qo‘llab-quvvatlanadi',
        );
      }
      const sellers = await manager.query(
        `SELECT id::text,shop_id::text FROM checkout.sales_order_seller WHERE sales_order_id=$1 ORDER BY id`,
        [input.orderId],
      );
      if (!sellers.length)
        throw new BadRequestException('Sub-buyurtmalar topilmadi');
      const items = (await manager.query(
        `SELECT i.variant_id::text AS "variantId",SUM(i.quantity)::int AS quantity
           FROM checkout.sales_order_item i JOIN checkout.sales_order_seller s ON s.id=i.sales_order_seller_id
          WHERE s.sales_order_id=$1 GROUP BY i.variant_id`,
        [input.orderId],
      )) as ReturnOrderItemsDto['items'];
      await sendRpc(this.payment!, { cmd: 'payment.refund' }, {
        paymentId: order.payment_id,
        salesOrderId: input.orderId,
        sellerOrderId: sellers[0].id,
        reason: input.reason,
        idempotencyKey: `admin-refund:${input.orderId}`,
      } satisfies RefundPaymentDto);
      await sendRpc(this.inventory!, { cmd: 'inventory.return-order-items' }, {
        orderRef: input.orderId,
        items,
        reason: input.reason,
        idempotencyKey: `admin-refund:${input.orderId}`,
      } satisfies ReturnOrderItemsDto);
      for (const seller of sellers) {
        await sendRpc(this.finance!, { cmd: 'finance.refund' }, {
          eventId: `admin-refund:${input.orderId}:${seller.id}`,
          sellerOrderId: seller.id,
          shopId: seller.shop_id,
          occurredAt: new Date().toISOString(),
        } satisfies FinanceRefundRequestedEvent);
      }
      await manager.query(
        `UPDATE checkout.sales_order SET status='REFUNDED',updated_at=now() WHERE id=$1`,
        [input.orderId],
      );
      await manager.query(
        `UPDATE checkout.sales_order_seller SET status='RETURNED',updated_at=now() WHERE sales_order_id=$1`,
        [input.orderId],
      );
      await manager.query(
        `INSERT INTO checkout.sales_order_seller_history (sales_order_seller_id,status,comment)
         SELECT id,'RETURNED',$2 FROM checkout.sales_order_seller WHERE sales_order_id=$1`,
        [input.orderId, `Admin refund: ${input.reason}`],
      );
      return {
        id: input.orderId,
        status: 'REFUNDED',
        idempotent: false,
        customerId: order.customer_id,
        shopIds: sellers.map((seller: { shop_id: string }) => seller.shop_id),
      };
    });
    if (result.shopIds.length > 0) {
      await this.notify(
        'order.refunded',
        result.customerId,
        result.shopIds,
        input.orderId,
        input.reason,
      );
    }
    const { customerId: _customerId, shopIds: _shopIds, ...response } = result;
    return response;
  }

  private async notify(
    type: string,
    customerId: string,
    shopIds: string[],
    orderId: string,
    reason: string,
  ) {
    if (!this.notifications) return;
    const sellerUserIds = this.catalog
      ? await Promise.all(
          shopIds.map(async (shopId) => {
            const shop = await sendRpc<{ ownerUserId: string }>(
              this.catalog!,
              { cmd: 'catalog.shop.get-by-id' },
              { shopId },
            );
            return String(shop.ownerUserId);
          }),
        )
      : [];
    const recipients = [customerId, ...sellerUserIds]
      .filter(Boolean)
      .filter((id, index, all) => all.indexOf(id) === index)
      .map((userId) => ({ userId }));
    if (!recipients.length) return;
    await firstValueFrom(
      this.notifications.emit(type, {
        orderId,
        reason,
        recipients,
      }),
      { defaultValue: undefined },
    );
  }

  /**
   * Buyurtma (sales_order_seller) holatini yangilaydi — do'kon bo'yicha scope
   * (shop_id). Boshqa do'kon buyurtmasi topilmaydi (403/404). Operator/owner.
   */
  async updateStatus(
    shopId: string,
    orderId: string,
    status: string,
  ): Promise<{ id: string; status: string }> {
    const ALLOWED = [
      'PENDING',
      'CONFIRMED',
      'SHIPMENT_CREATED',
      'ON_THE_ROAD',
      'DELIVERED',
      'CANCELLED',
      'RETURNED',
    ];
    if (!ALLOWED.includes(status)) {
      throw new BadRequestException('status noto‘g‘ri');
    }
    const rows = await this.dataSource.query(
      `UPDATE checkout.sales_order_seller
         SET status = $1, updated_at = now()
       WHERE id = $2 AND shop_id = $3
       RETURNING id, status`,
      [status, String(orderId), String(shopId)],
    );
    if (!rows.length) {
      throw new NotFoundException('Buyurtma topilmadi yoki ruxsat yo‘q');
    }
    await this.dataSource.query(
      `INSERT INTO checkout.sales_order_seller_history(sales_order_seller_id,status) VALUES($1,$2)`,
      [orderId, status],
    );
    return { id: String(rows[0].id), status: String(rows[0].status) };
  }

  async getSellerOrder(shopId: string, id: string) {
    const rows = await this.dataSource.query(
      `SELECT s.id,s.sales_order_id AS "salesOrderId",s.shop_id AS "shopId",o.buyer_name AS "buyerName",o.delivery_address AS "deliveryAddress",o.region_id AS "regionId",o.district_id AS "districtId",o.where_deliver AS "whereDeliver",s.subtotal,s.delivery_fee AS "deliveryFee",s.cod_amount AS "codAmount",s.status,s.elchi_shipment_id AS "elchiShipmentId",s.tracking_url AS "trackingUrl",s.created_at AS "createdAt",s.updated_at AS "updatedAt" FROM checkout.sales_order_seller s JOIN checkout.sales_order o ON o.id=s.sales_order_id WHERE s.id=$1 AND s.shop_id=$2`,
      [id, shopId],
    );
    if (!rows[0])
      throw new NotFoundException('Buyurtma topilmadi yoki ruxsat yo‘q');
    const r = rows[0];
    return {
      ...r,
      id: String(r.id),
      salesOrderId: String(r.salesOrderId),
      subtotal: Number(r.subtotal),
      codAmount: Number(r.codAmount),
    };
  }
  async getItems(shopId: string, id: string) {
    await this.getSellerOrder(shopId, id);
    const rows = await this.dataSource.query(
      `SELECT i.id,i.product_id AS "productId",i.product_name AS "productName",i.variant_id AS "variantId",i.quantity,i.unit_price AS "unitPrice",i.line_total AS "lineTotal" FROM checkout.sales_order_item i WHERE i.sales_order_seller_id=$1 ORDER BY i.id`,
      [id],
    );
    return rows.map((r: any) => ({
      ...r,
      id: String(r.id),
      productId: String(r.productId),
      variantId: String(r.variantId),
      quantity: Number(r.quantity),
      unitPrice: Number(r.unitPrice),
      lineTotal: Number(r.lineTotal),
    }));
  }
  async history(shopId: string, id: string) {
    const order = await this.getSellerOrder(shopId, id);
    const rows = await this.dataSource.query(
      `SELECT id,status,comment,created_at AS "createdAt" FROM checkout.sales_order_seller_history WHERE sales_order_seller_id=$1 ORDER BY created_at`,
      [id],
    );
    return rows.length
      ? rows
      : [
          {
            id: null,
            status: order.status,
            comment: null,
            createdAt: order.createdAt,
          },
        ];
  }
  async shipments(shopId: string, q: SellerOrdersQueryDto) {
    return this.findAll(shopId, q, true);
  }
  async createShipment(shopId: string, id: string, customerPhone?: string) {
    const order: any = await this.getSellerOrder(shopId, id);
    if (order.elchiShipmentId) return order;
    if (!['PENDING', 'CONFIRMED'].includes(order.status))
      throw new BadRequestException(
        'Shipment faqat yangi yoki tasdiqlangan buyurtma uchun yaratiladi',
      );
    const items: any[] = await this.getItems(shopId, id);
    if (!this.integration)
      throw new BadRequestException('Yetkazib berish servisi mavjud emas');
    const result = await sendRpc<{
      shipment_id: string;
      tracking_url?: string;
    }>(
      this.integration,
      { cmd: 'integration.shipment.create' },
      {
        external_order_id: `seller-order-${id}`,
        elchi_market_id: String(order.shopId),
        customer: {
          name: order.buyerName ?? 'Mijoz',
          phone: customerPhone ?? '',
        },
        address: order.deliveryAddress ?? '',
        region_id: order.regionId,
        district_id: order.districtId,
        where_deliver: order.whereDeliver,
        items: items.map((x) => ({
          name: x.productName,
          quantity: x.quantity,
        })),
        cod_amount: order.codAmount,
      },
    );
    await this.dataSource.query(
      `UPDATE checkout.sales_order_seller SET elchi_shipment_id=$1,tracking_url=$2,status='SHIPMENT_CREATED',updated_at=now() WHERE id=$3 AND shop_id=$4`,
      [result.shipment_id, result.tracking_url ?? null, id, shopId],
    );
    await this.dataSource.query(
      `INSERT INTO checkout.sales_order_seller_history(sales_order_seller_id,status,comment) VALUES($1,'SHIPMENT_CREATED','Yetkazib berish yaratildi')`,
      [id],
    );
    return this.getSellerOrder(shopId, id);
  }
}
