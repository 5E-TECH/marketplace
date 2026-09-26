import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CheckoutPaymentMethod,
  ElchiShipmentResult,
  FinanceRefundRequestedEvent,
  PaymentSummaryDto,
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
import {
  ShippingLabelData,
  SkippedShippingLabel,
} from './shipping-label.service';

interface CountRow {
  total: string | number;
}

/** Yorliq so'ralgan seller-order (sales_order_seller) va uning do'koni. */
export interface ShippingLabelTarget {
  shopId: string;
  sellerOrderId: string;
  /** Chaqiruvchi ko'rgan id: sotuvchi uchun seller-order, admin uchun sales_order. */
  orderId: string;
}

/**
 * Bitta partiya ichidagi takroriy RPC'lar keshi: 100 ta yorliq bitta do'kon
 * yoki viloyatdan bo'lsa, nomlar bir marta so'raladi (sendRpc 10 s chegarasi).
 */
interface LabelLookupCache {
  shops: Map<string, Promise<string | null>>;
  regions?: Promise<Map<string, string>>;
  districts: Map<string, Promise<Map<string, string>>>;
}

@Injectable()
export class SellerOrdersService {
  private readonly logger = new Logger(SellerOrdersService.name);

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

  async buyerTracking(
    orderId: string,
    customerId?: string,
    sessionId?: string,
  ) {
    await this.assertBuyerOwnership(orderId, customerId, sessionId);

    const rows = (await this.dataSource.query(
      `SELECT o.id::text AS "orderId",o.customer_id::text AS "customerId",
              o.session_id AS "sessionId",o.status AS "orderStatus",
              o.updated_at AS "orderUpdatedAt",s.id::text AS "sellerOrderId",
              s.shop_id::text AS "shopId",sh.name AS "shopName",
              s.elchi_shipment_id::text AS "shipmentId",
              s.status AS "shipmentStatus",s.tracking_url AS "trackingUrl",
              s.updated_at AS "updatedAt"
         FROM checkout.sales_order o
         LEFT JOIN checkout.sales_order_seller s ON s.sales_order_id=o.id
         LEFT JOIN catalog.shop sh ON sh.id=s.shop_id
        WHERE o.id=$1
        ORDER BY s.id`,
      [orderId],
    )) as Array<Record<string, unknown>>;

    if (!rows.length) throw new NotFoundException('Buyurtma topilmadi');
    const shipmentStatus = (status: unknown) =>
      status === 'ON_THE_ROAD' ? 'OUT_FOR_DELIVERY' : String(status);
    const statuses = rows
      .map((row) => String(row.shipmentStatus ?? ''))
      .filter(Boolean);
    const orderStatus = statuses.some((status) => status === 'ON_THE_ROAD')
      ? 'IN_TRANSIT'
      : statuses.length > 0 &&
          statuses.every((status) => status === 'DELIVERED')
        ? 'DELIVERED'
        : String(rows[0].orderStatus);
    const updatedAt = rows.reduce<Date | string>(
      (latest, row) => {
        const candidate = row.updatedAt as Date | string | undefined;
        return candidate && new Date(candidate) > new Date(latest)
          ? candidate
          : latest;
      },
      rows[0].orderUpdatedAt as Date | string,
    );

    const summaries = await this.paymentSummaries([String(rows[0].orderId)]);
    return {
      orderId: String(rows[0].orderId),
      orderStatus,
      estimatedDeliveryAt: null,
      updatedAt,
      payment: this.paymentView(summaries[String(rows[0].orderId)]),
      shipments: rows
        .filter((row) => row.sellerOrderId)
        .map((row) => ({
          shipmentId: row.shipmentId
            ? String(row.shipmentId)
            : String(row.sellerOrderId),
          shopId: String(row.shopId),
          shopName: String(row.shopName ?? ''),
          shipmentStatus: shipmentStatus(row.shipmentStatus),
          trackingUrl: row.trackingUrl ? String(row.trackingUrl) : null,
          updatedAt: row.updatedAt as Date | string,
        })),
    };
  }

  async buyerOrderDetails(
    orderId: string,
    customerId?: string,
    sessionId?: string,
  ) {
    await this.assertBuyerOwnership(orderId, customerId, sessionId);
    const { customerId: _customerId, ...details } =
      await this.adminGetOrder(orderId);
    return details;
  }

  async buyerOrders(
    customerId: string,
    query: { page?: number; limit?: number } = {},
  ) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const [countRow] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total
         FROM checkout.sales_order WHERE customer_id=$1`,
      [customerId],
    );
    const total = Number(countRow?.total ?? 0);
    const orders = (await this.dataSource.query(
      `SELECT id::text AS "orderId",created_at AS "createdAt",
              status AS "orderStatus",payment_method AS "paymentMethod",
              total_amount::float8 AS "totalAmount",
              delivery_fee::float8 AS "deliveryFee"
         FROM checkout.sales_order
        WHERE customer_id=$1
        ORDER BY created_at DESC,id DESC
        LIMIT $2 OFFSET $3`,
      [customerId, limit, (page - 1) * limit],
    )) as Array<Record<string, unknown>>;
    const orderIds = orders.map((order) => String(order.orderId));
    const itemRows = orderIds.length
      ? ((await this.dataSource.query(
          `SELECT s.sales_order_id::text AS "orderId",i.id::text AS id,
                  i.product_id::text AS "productId",
                  i.product_name AS name,i.quantity,i.unit_price::float8 AS "unitPrice",
                  p.image_url AS "imageUrl",s.status AS "sellerOrderStatus"
             FROM checkout.sales_order_item i
             JOIN checkout.sales_order_seller s ON s.id=i.sales_order_seller_id
             LEFT JOIN catalog.product p ON p.id=i.product_id
            WHERE s.sales_order_id=ANY($1::bigint[])
            ORDER BY i.id`,
          [orderIds],
        )) as Array<Record<string, unknown>>)
      : [];
    const itemsByOrder = new Map<string, Array<Record<string, unknown>>>();
    for (const item of itemRows) {
      const key = String(item.orderId);
      const items = itemsByOrder.get(key) ?? [];
      items.push({
        id: String(item.id),
        productId: String(item.productId),
        name: String(item.name),
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        imageUrl: item.imageUrl ? String(item.imageUrl) : null,
        sellerOrderStatus: String(item.sellerOrderStatus),
      });
      itemsByOrder.set(key, items);
    }
    const summaries = await this.paymentSummaries(orderIds);
    return {
      items: orders.map((order) => ({
        orderId: String(order.orderId),
        createdAt: order.createdAt,
        orderStatus: order.orderStatus,
        paymentMethod: String(order.paymentMethod ?? ''),
        paymentProvider: summaries[String(order.orderId)]?.provider ?? null,
        paymentStatus: summaries[String(order.orderId)]?.status ?? null,
        subtotal: Number(order.totalAmount) - Number(order.deliveryFee),
        deliveryFee: Number(order.deliveryFee),
        totalAmount: Number(order.totalAmount),
        items: itemsByOrder.get(String(order.orderId)) ?? [],
      })),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  /**
   * To'lov holati payment-service'da — checkout `payment` sxemasiga kira
   * olmaydi (least-privilege). Payment-service javob bermasa buyurtma
   * ro'yxati baribir ochilishi kerak, shuning uchun xato yutiladi.
   */
  private async paymentSummaries(
    orderIds: string[],
  ): Promise<Record<string, PaymentSummaryDto>> {
    if (!this.payment || !orderIds.length) return {};
    try {
      return await sendRpc<Record<string, PaymentSummaryDto>>(
        this.payment,
        { cmd: 'payment.summary-by-orders' },
        { salesOrderIds: orderIds },
      );
    } catch {
      return {};
    }
  }

  /**
   * COD buyurtmada, shuningdek online tanlanib to'lov hali boshlanmagan
   * buyurtmada payment yozuvi bo'lmaydi — `null` qaytadi.
   */
  private paymentView(summary?: PaymentSummaryDto): {
    id: string;
    provider: string;
    amount: number;
    status: string;
    failureReason: string | null;
    updatedAt: Date | string;
  } | null {
    if (!summary) return null;
    return {
      id: summary.paymentId,
      provider: summary.provider,
      amount: summary.amount,
      status: summary.status,
      failureReason: summary.failureReason ?? null,
      updatedAt: summary.updatedAt,
    };
  }

  private async assertBuyerOwnership(
    orderId: string,
    customerId?: string,
    sessionId?: string,
  ): Promise<void> {
    if (
      !/^[1-9]\d{0,18}$/.test(orderId) ||
      BigInt(orderId) > BigInt('9223372036854775807')
    ) {
      throw new NotFoundException('Buyurtma topilmadi');
    }
    const [order] = (await this.dataSource.query(
      `SELECT customer_id::text AS "customerId",session_id AS "sessionId"
         FROM checkout.sales_order WHERE id=$1`,
      [orderId],
    )) as Array<{ customerId: string; sessionId: string | null }>;
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const belongsToBuyer =
      customerId && String(order.customerId) === String(customerId);
    const belongsToGuest =
      sessionId && String(order.sessionId ?? '') === String(sessionId);
    if (!belongsToBuyer && !belongsToGuest) {
      throw new ForbiddenException('Bu buyurtmani ko‘rishga ruxsat yo‘q');
    }
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
                 WHERE s.sales_order_id = so.id) AS "sellersCount",
              (SELECT COUNT(*)::int FROM checkout.sales_order_seller s
                 WHERE s.sales_order_id = so.id
                   AND s.elchi_shipment_id IS NOT NULL) AS "shipmentsCount"
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
        // Yorliq faqat posilkasi bor sub-buyurtma uchun chiqadi — admin
        // jadvali shunga qarab chop etish belgisini o'chiradi (C1.45).
        shipmentsCount: Number(r.shipmentsCount ?? 0),
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
                sos.tracking_url AS "trackingUrl",
                sos.qr_code_token IS NOT NULL AS "hasQrToken"
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
        hasQrToken: Boolean(s.hasQrToken),
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
      // Avval to'lovni yopamiz: bekor qilingan buyurtmani xaridor provayder
      // sahifasida to'lab yuborishi mumkin bo'lmasin.
      if (this.payment && order.payment_method !== CheckoutPaymentMethod.COD) {
        await sendRpc(
          this.payment,
          { cmd: 'payment.cancel-open' },
          { salesOrderId: input.orderId, reason: input.reason },
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

  /**
   * Xaridorning o'z buyurtmasini qaytarishi. Bitta endpoint ikki holatni
   * qoplaydi, chunki xaridor uchun bu bir xil amal ("buyurtmani qaytarish"):
   *   • hali to'lanmagan (DRAFT/PENDING_PAYMENT) → bekor qilinadi, rezerv
   *     bo'shatiladi, ochiq to'lov yozuvi yopiladi;
   *   • to'langan, lekin posilka hali sotuvchidan chiqmagan → to'liq refund.
   * Posilka yo'lga chiqqandan keyin o'z-o'ziga xizmat qilish yopiladi —
   * bunda operator `POST /admin/orders/:id/refund` bilan hal qiladi.
   */
  async buyerRefundOrder(input: {
    orderId: string;
    reason: string;
    customerId?: string;
    sessionId?: string;
  }) {
    await this.assertBuyerOwnership(
      input.orderId,
      input.customerId,
      input.sessionId,
    );
    const [order] = (await this.dataSource.query(
      `SELECT status,payment_method AS "paymentMethod" FROM checkout.sales_order WHERE id=$1`,
      [input.orderId],
    )) as Array<{ status: string; paymentMethod: string }>;
    if (!order) throw new NotFoundException('Buyurtma topilmadi');

    if (order.status === 'CANCELLED')
      return { id: input.orderId, status: 'CANCELLED', idempotent: true };
    if (order.status === 'REFUNDED')
      return { id: input.orderId, status: 'REFUNDED', idempotent: true };

    const reason = input.reason?.trim() || 'Xaridor buyurtmani qaytardi';
    const actorId = input.customerId ?? input.sessionId ?? 'guest';

    if (['DRAFT', 'PENDING_PAYMENT'].includes(order.status)) {
      return this.adminCancelOrder({ orderId: input.orderId, reason, actorId });
    }

    if (order.paymentMethod === CheckoutPaymentMethod.COD) {
      throw new BadRequestException(
        'Naqd to‘lovli buyurtmani bu yerdan qaytarib bo‘lmaydi — kuryerga rad javobini bering',
      );
    }

    const shipped = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM checkout.sales_order_seller
        WHERE sales_order_id=$1
          AND status NOT IN ('PENDING','CONFIRMED','SHIPMENT_CREATED')`,
      [input.orderId],
    )) as CountRow[];
    if (Number(shipped[0]?.total ?? 0) > 0) {
      throw new BadRequestException(
        'Posilka yo‘lga chiqqan — qaytarish uchun qo‘llab-quvvatlash xizmatiga murojaat qiling',
      );
    }

    return this.adminRefundOrder({ orderId: input.orderId, reason, actorId });
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
      'RECEIVED',
      'ON_THE_ROAD',
      'DELIVERED',
      'CANCELLED',
      'RETURNED',
    ];
    if (!ALLOWED.includes(status)) {
      throw new BadRequestException('status noto‘g‘ri');
    }
    // Postgres drayveri `UPDATE ... RETURNING` uchun `[qatorlar, soni]`
    // qaytaradi, `SELECT` uchun esa oddiy massiv. Avval natija to'g'ridan-to'g'ri
    // qatorlar deb o'qilardi va javobda `{"id":"undefined","status":"undefined"}`
    // chiqardi (holat bazada TO'G'RI yangilanardi — faqat javob buzuq edi).
    // Ikkala shaklni ham qabul qilamiz: drayver xatti-harakati versiyaga bog'liq.
    const result = (await this.dataSource.query(
      `UPDATE checkout.sales_order_seller
         SET status = $1, updated_at = now()
       WHERE id = $2 AND shop_id = $3
       RETURNING id, status`,
      [status, String(orderId), String(shopId)],
    )) as unknown[];
    const rows = (Array.isArray(result[0]) ? result[0] : result) as Array<{
      id: string;
      status: string;
    }>;
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
      `SELECT s.id,s.sales_order_id AS "salesOrderId",s.shop_id AS "shopId",o.buyer_name AS "buyerName",o.delivery_address AS "deliveryAddress",o.region_id AS "regionId",o.district_id AS "districtId",o.where_deliver AS "whereDeliver",s.subtotal,s.delivery_fee AS "deliveryFee",s.cod_amount AS "codAmount",s.status,s.elchi_shipment_id AS "elchiShipmentId",s.tracking_url AS "trackingUrl",s.qr_code_token AS "qrCodeToken",s.elchi_to_be_paid AS "elchiToBePaid",s.created_at AS "createdAt",s.updated_at AS "updatedAt" FROM checkout.sales_order_seller s JOIN checkout.sales_order o ON o.id=s.sales_order_id WHERE s.id=$1 AND s.shop_id=$2`,
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
      // `deliveryFee` ATAYLAB qo'shildi: u ham `numeric` ustun, ya'ni
      // node-postgres uni SATR qilib qaytaradi ("0.00") va javobga shundayligicha
      // chiqib ketardi — qolgan summalar son bo'lgani holda.
      deliveryFee: Number(r.deliveryFee),
      codAmount: Number(r.codAmount),
      elchiToBePaid:
        r.elchiToBePaid === null || r.elchiToBePaid === undefined
          ? null
          : Number(r.elchiToBePaid),
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

  async getShippingLabelData(
    shopId: string,
    id: string,
    cache: LabelLookupCache = this.newLabelCache(),
  ): Promise<ShippingLabelData> {
    // getSellerOrder shop_id bilan scope qiladi: begona do‘kon uchun 404.
    const order: any = await this.getSellerOrder(shopId, id);
    if (!order.elchiShipmentId) {
      throw new ConflictException(
        'Yorliq uchun avval Elchi shipment yaratish kerak',
      );
    }
    // Buyurtma id'sini QR ga yozish (Elchi frontidagi fallback) ATAYLAB yo'q:
    // Elchi skaneri (`order.find_by_qr`) faqat `qr_code_token` bo'yicha
    // qidiradi, ya'ni bunday yorliq chop etilsa ham pochtada skanerlanmaydi.
    // Uning o'rniga yo'qolgan token Elchi'dan qayta olinadi.
    if (!order.qrCodeToken) await this.recoverShipmentToken(order);
    if (!order.qrCodeToken) {
      throw new ConflictException('Elchi shipment QR tokeni mavjud emas');
    }
    const [items, senderName, geo] = await Promise.all([
      this.getItems(shopId, id),
      this.shopName(String(order.shopId), cache),
      this.geoNames(order.regionId, order.districtId, cache),
    ]);
    const delivery = this.parseDelivery(order.deliveryAddress);
    return {
      sellerOrderId: String(order.id),
      salesOrderId: String(order.salesOrderId),
      shipmentId: String(order.elchiShipmentId),
      qrCodeToken: String(order.qrCodeToken),
      senderName: senderName ?? `Do‘kon #${order.shopId}`,
      buyerName: String(order.buyerName ?? 'Mijoz'),
      buyerPhone: delivery.phone,
      regionName: geo.regionName,
      districtName: geo.districtName,
      deliveryAddress: delivery.address,
      // Kuryer Elchi aytgan summani oladi; u bo'lmasa (eski satrlar) o'zimiz
      // hisoblagan `cod_amount`.
      codAmount: Number(order.elchiToBePaid ?? order.codAmount),
      items: items.map((item: any) => ({
        productName: String(item.productName),
        quantity: Number(item.quantity),
      })),
    };
  }

  /**
   * Bir nechta yorliq: har biri alohida — bittasi yiqilsa qolganlari chiqadi.
   * Avval `Promise.all` bitta tokensiz buyurtma bilan butun partiyani (PDF ni)
   * yo'qotardi.
   */
  async collectShippingLabels(targets: ShippingLabelTarget[]): Promise<{
    labels: ShippingLabelData[];
    skipped: SkippedShippingLabel[];
  }> {
    const cache = this.newLabelCache();
    const results = await Promise.allSettled(
      targets.map((target) =>
        this.getShippingLabelData(target.shopId, target.sellerOrderId, cache),
      ),
    );
    const labels: ShippingLabelData[] = [];
    const skipped: SkippedShippingLabel[] = [];
    results.forEach((result, index) => {
      const target = targets[index];
      if (result.status === 'fulfilled') {
        labels.push(result.value);
        return;
      }
      skipped.push({
        orderId: target.orderId,
        ...(target.sellerOrderId !== target.orderId
          ? { sellerOrderId: target.sellerOrderId }
          : {}),
        reason: this.errorMessage(result.reason),
      });
    });
    return { labels, skipped };
  }

  /**
   * Admin yorlig'i uchun maqsadlar. `orderIds` — `sales_order.id`, ya'ni admin
   * ro'yxati, `GET /admin/orders/:id` va `:id/cancel` bilan BIR XIL id fazosi.
   * Avval bu yerda id `sales_order_seller.id` deb o'qilardi: ikki do'konli
   * buyurtmadan keyin ketma-ketliklar ajralib, admin BOSHQA xaridorning
   * yorlig'ini jimgina chop etardi. Endi buyurtmaning har bir posilkasi
   * (do'koni) uchun alohida yorliq chiqadi.
   */
  async adminShippingLabelTargets(orderIds: string[]): Promise<{
    targets: ShippingLabelTarget[];
    missing: SkippedShippingLabel[];
  }> {
    const ids = orderIds.map(String);
    // Raqam bo'lmagan id `::bigint[]` cast'ini yiqitib, butun partiyani 500
    // qilardi — u shunchaki "topilmadi" bo'lib qoladi.
    const valid = ids.filter((id) => /^[1-9]\d*$/.test(id));
    const rows = (await this.dataSource.query(
      `SELECT id::text AS "sellerOrderId", sales_order_id::text AS "orderId",
              shop_id::text AS "shopId"
         FROM checkout.sales_order_seller
        WHERE sales_order_id = ANY($1::bigint[])
        ORDER BY sales_order_id, id`,
      [valid],
    )) as ShippingLabelTarget[];
    const byOrder = new Map<string, ShippingLabelTarget[]>();
    for (const row of rows) {
      const list = byOrder.get(row.orderId) ?? [];
      list.push(row);
      byOrder.set(row.orderId, list);
    }
    const targets: ShippingLabelTarget[] = [];
    const missing: SkippedShippingLabel[] = [];
    // So'ralgan tartib saqlanadi — admin belgilagan ketma-ketlikda chop etadi.
    for (const id of ids) {
      const list = byOrder.get(id);
      if (list?.length) targets.push(...list);
      else missing.push({ orderId: id, reason: 'Buyurtma topilmadi' });
    }
    return { targets, missing };
  }

  /** Admin: bitta posilka yorlig'i — seller-order shu buyurtmaga tegishli bo'lsin. */
  async getShippingLabelDataForAdmin(
    orderId: string,
    sellerOrderId: string,
  ): Promise<ShippingLabelData> {
    const rows = await this.dataSource.query(
      `SELECT shop_id::text AS "shopId"
         FROM checkout.sales_order_seller
        WHERE id=$1 AND sales_order_id=$2`,
      [String(sellerOrderId), String(orderId)],
    );
    if (!rows[0]) throw new NotFoundException('Buyurtma topilmadi');
    return this.getShippingLabelData(
      String(rows[0].shopId),
      String(sellerOrderId),
    );
  }

  /**
   * Posilkasi bor, lekin tokeni NULL (yoki soxta) satrlarni Elchi bilan
   * tenglashtiradi — bir martalik backfill (C1.45). Xaridor oqimi 2026-09
   * gacha tokenni saqlamagan, 9-buyurtmada esa qo'lda yozilgan test tokeni
   * turibdi; ularni `createShipment` qayta chaqirib tuzatib bo'lmaydi, chunki
   * shipment id bor bo'lsa u darhol qaytib ketadi.
   *
   * Kursor bilan (`afterId`) bo'lak-bo'lak: har satr Elchi'ga bitta so'rov,
   * gateway esa RPC javobini 10 s kutadi.
   */
  async syncShipmentTokens(input: {
    afterId?: string;
    limit?: number;
    dryRun?: boolean;
  }) {
    if (!this.integration)
      throw new BadRequestException('Yetkazib berish servisi mavjud emas');
    const limit = Math.min(50, Math.max(1, Number(input.limit ?? 20)));
    const rows = (await this.dataSource.query(
      `SELECT id::text, elchi_shipment_id::text AS "shipmentId",
              qr_code_token AS "qrCodeToken",
              elchi_to_be_paid::text AS "toBePaid"
         FROM checkout.sales_order_seller
        WHERE elchi_shipment_id IS NOT NULL AND id > $1
        ORDER BY id
        LIMIT $2`,
      [String(input.afterId ?? '0'), limit],
    )) as Array<{
      id: string;
      shipmentId: string;
      qrCodeToken: string | null;
      toBePaid: string | null;
    }>;
    const items: Array<{
      sellerOrderId: string;
      shipmentId: string;
      action: 'updated' | 'unchanged' | 'failed';
      tokenBefore: string | null;
      tokenAfter: string | null;
      error?: string;
    }> = [];
    for (const row of rows) {
      try {
        const shipment = await sendRpc<ElchiShipmentResult>(
          this.integration,
          { cmd: 'integration.shipment.get' },
          { shipmentId: row.shipmentId },
        );
        const token = shipment.qr_code_token ?? null;
        const toBePaid = shipment.to_be_paid ?? null;
        const changed =
          token !== row.qrCodeToken ||
          (toBePaid !== null &&
            (row.toBePaid === null || Number(row.toBePaid) !== toBePaid));
        if (!token) {
          items.push({
            sellerOrderId: row.id,
            shipmentId: row.shipmentId,
            action: 'failed',
            tokenBefore: row.qrCodeToken,
            tokenAfter: null,
            error: 'Elchi javobida qr_code_token yo‘q',
          });
          continue;
        }
        if (changed && !input.dryRun) {
          await this.dataSource.query(
            `UPDATE checkout.sales_order_seller
                SET qr_code_token=$1,
                    elchi_to_be_paid=COALESCE($2, elchi_to_be_paid),
                    updated_at=now()
              WHERE id=$3`,
            [token, toBePaid, row.id],
          );
        }
        items.push({
          sellerOrderId: row.id,
          shipmentId: row.shipmentId,
          action: changed ? 'updated' : 'unchanged',
          tokenBefore: row.qrCodeToken,
          tokenAfter: token,
        });
      } catch (error) {
        items.push({
          sellerOrderId: row.id,
          shipmentId: row.shipmentId,
          action: 'failed',
          tokenBefore: row.qrCodeToken,
          tokenAfter: null,
          error: this.errorMessage(error),
        });
      }
    }
    return {
      dryRun: Boolean(input.dryRun),
      items,
      nextAfterId: rows.length === limit ? rows[rows.length - 1].id : null,
    };
  }

  /**
   * Token bazada yo'q, lekin posilka bor — Elchi'dan olib saqlaydi va
   * `order` ni joyida yangilaydi. Elchi javob bermasa jim qoladi: chaqiruvchi
   * aniq 409 xabarini beradi, xato esa log'ga tushadi.
   */
  private async recoverShipmentToken(order: any): Promise<void> {
    if (!this.integration) return;
    let shipment: ElchiShipmentResult;
    try {
      shipment = await sendRpc<ElchiShipmentResult>(
        this.integration,
        { cmd: 'integration.shipment.get' },
        { shipmentId: String(order.elchiShipmentId) },
      );
    } catch (error) {
      this.logger.warn(
        `seller-order ${order.id}: Elchi'dan QR token olinmadi — ${this.errorMessage(error)}`,
      );
      return;
    }
    if (!shipment.qr_code_token) return;
    await this.dataSource.query(
      `UPDATE checkout.sales_order_seller
          SET qr_code_token=$1,
              elchi_to_be_paid=COALESCE(elchi_to_be_paid,$2),
              updated_at=now()
        WHERE id=$3 AND qr_code_token IS NULL`,
      [shipment.qr_code_token, shipment.to_be_paid ?? null, String(order.id)],
    );
    order.qrCodeToken = shipment.qr_code_token;
    order.elchiToBePaid ??= shipment.to_be_paid ?? null;
  }

  private newLabelCache(): LabelLookupCache {
    return { shops: new Map(), districts: new Map() };
  }

  /** Jo'natuvchi do'kon nomi; catalog javob bermasa yorliq baribir chiqadi. */
  private shopName(
    shopId: string,
    cache: LabelLookupCache,
  ): Promise<string | null> {
    let name = cache.shops.get(shopId);
    if (!name) {
      name = this.catalog
        ? sendRpc<{ name?: string }>(
            this.catalog,
            { cmd: 'catalog.shop.get-by-id' },
            { shopId },
          )
            .then((shop) => shop?.name?.trim() || null)
            .catch(() => null)
        : Promise.resolve(null);
      cache.shops.set(shopId, name);
    }
    return name;
  }

  /** Viloyat/tuman NOMI (bazada faqat Elchi id'lari turadi). */
  private async geoNames(
    regionId: string | null,
    districtId: string | null,
    cache: LabelLookupCache,
  ): Promise<{ regionName: string | null; districtName: string | null }> {
    if (!this.integration || !regionId) {
      return { regionName: null, districtName: null };
    }
    const integration = this.integration;
    const toMap = (rows: Array<{ id: string; name: string }>) =>
      new Map(rows.map((row) => [String(row.id), row.name]));
    cache.regions ??= sendRpc<Array<{ id: string; name: string }>>(
      integration,
      { cmd: 'integration.regions.list' },
      {},
    )
      .then(toMap)
      .catch(() => new Map<string, string>());
    const regionKey = String(regionId);
    let districts = cache.districts.get(regionKey);
    if (!districts) {
      districts = sendRpc<Array<{ id: string; name: string }>>(
        integration,
        { cmd: 'integration.districts.list' },
        { regionId: regionKey },
      )
        .then(toMap)
        .catch(() => new Map<string, string>());
      cache.districts.set(regionKey, districts);
    }
    const [regions, districtNames] = await Promise.all([
      cache.regions,
      districts,
    ]);
    return {
      regionName: regions.get(regionKey) ?? null,
      districtName: districtId
        ? (districtNames.get(String(districtId)) ?? null)
        : null,
    };
  }

  private errorMessage(error: unknown): string {
    const e = error as {
      response?: { message?: unknown };
      message?: unknown;
    };
    const message = e?.response?.message ?? e?.message ?? error;
    return Array.isArray(message) ? message.join(', ') : String(message);
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
    const result = await sendRpc<ElchiShipmentResult>(
      this.integration,
      { cmd: 'integration.shipment.create' },
      {
        external_order_id: `seller-order-${id}`,
        // `shopId` ATAYLAB: bu marketplace'ning ICHKI do'kon id'si, Elchi
        // market id'si emas. O'girish elchi-integration servisida bo'ladi —
        // mapping o'sha yerda saqlanadi. Avval bu qiymat to'g'ridan-to'g'ri
        // `elchi_market_id` sifatida ketardi va Elchi 403 bilan rad etardi.
        shopId: String(order.shopId),
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
      `UPDATE checkout.sales_order_seller SET elchi_shipment_id=$1,tracking_url=$2,qr_code_token=$3,elchi_to_be_paid=$4,status='SHIPMENT_CREATED',updated_at=now() WHERE id=$5 AND shop_id=$6`,
      [
        result.shipment_id,
        result.tracking_url ?? null,
        // Pochta posilkani shu token bo'yicha skanerlab qabul qiladi va
        // yorliqdagi QR ichiga ham shu yoziladi (C1.45).
        result.qr_code_token ?? null,
        result.to_be_paid ?? null,
        id,
        shopId,
      ],
    );
    await this.dataSource.query(
      `INSERT INTO checkout.sales_order_seller_history(sales_order_seller_id,status,comment) VALUES($1,'SHIPMENT_CREATED','Yetkazib berish yaratildi')`,
      [id],
    );
    return this.getSellerOrder(shopId, id);
  }

  private parseDelivery(value?: string | null): {
    address: string;
    phone: string;
  } {
    const lines = String(value ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const phoneIndex = lines.findIndex((line) => /^\+998\d{9}$/.test(line));
    const phone = phoneIndex >= 0 ? lines.splice(phoneIndex, 1)[0] : '';
    return { address: lines.join(', '), phone };
  }
}
