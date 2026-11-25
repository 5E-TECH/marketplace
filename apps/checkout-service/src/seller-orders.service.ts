import {
  BadRequestException,
  ConflictException,
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
  RefundPaymentDto,
  ReturnOrderItemsDto,
} from '@app/common';
import { DataSource } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { RmqClient, sendRpc } from '@app/common';
import { firstValueFrom } from 'rxjs';
import {
  ShippingLabelData,
  SkippedShippingLabel,
} from './shipping-label.service';
import { shopOwnerUserId } from './catalog-shop.util';

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

/** Ro‘yxatda telefon — oxirgi 4 ta raqam (lead-service `maskPhone` bilan bir xil; ega qarori 2026-11-23). */
export const maskPhone = (p: string) => `****${p.slice(-4)}`;

/**
 * Eski do‘kon buyurtmasi (sales_order_seller): yangi holat → qaysi holatlardan o‘tish mumkin (BE-18, T9-8) [taklif].
 * Orqaga va yakuniy holatlardan (CANCELLED, RETURNED) o‘tish yo‘q.
 */
export const LEGACY_SELLER_TRANSITIONS: Readonly<Record<string, string[]>> = {
  PENDING: [],
  CONFIRMED: ['PENDING'],
  SHIPMENT_CREATED: ['CONFIRMED'],
  RECEIVED: ['SHIPMENT_CREATED'],
  ON_THE_ROAD: ['SHIPMENT_CREATED', 'RECEIVED'],
  DELIVERED: ['RECEIVED', 'ON_THE_ROAD'],
  CANCELLED: ['PENDING', 'CONFIRMED', 'SHIPMENT_CREATED'],
  RETURNED: ['ON_THE_ROAD', 'DELIVERED'],
};

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
    source?: string;
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
    if (query?.source) {
      params.push(query.source);
      conditions.push(`so.source = $${params.length}`);
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
              so.source, so.lead_id::text AS "leadId",
              so.affiliate_id::text AS "affiliateId",
              so.customer_phone AS "customerPhone",
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
        // BE-18: liddan buyurtma — manba, lid, sotuvchi; ro‘yxatda telefon niqoblangan (FE-26)
        source: (r.source as string) ?? null,
        leadId: (r.leadId as string) ?? null,
        affiliateId: (r.affiliateId as string) ?? null,
        phoneMasked: r.customerPhone
          ? maskPhone(String(r.customerPhone))
          : null,
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
              so.updated_at AS "updatedAt",
              so.source, so.lead_id::text AS "leadId", so.stream_id::text AS "streamId",
              so.affiliate_id::text AS "affiliateId", so.wholesaler_id::text AS "wholesalerId",
              so.customer_phone AS "customerPhone", so.region_soato AS "regionSoato",
              so.district_soato AS "districtSoato", so.where_deliver AS "whereDeliver",
              so.delivery_mode AS "deliveryMode", so.delivery_shown::text AS "deliveryShown",
              so.delivery_cost::text AS "deliveryCost",
              so.delivery_embedded::text AS "deliveryEmbedded",
              so.weight_grams AS "weightGrams", so.cod_amount::text AS "codAmount",
              so.confirmed_by::text AS "confirmedBy",
              so.address_confirmed_by::text AS "addressConfirmedBy"
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
                i.line_total AS "lineTotal",
                i.sku, i.weight_grams AS "weightGrams",
                i.base_price::text AS "basePrice",
                i.recommended_price::text AS "recommendedPrice",
                i.approved_price::text AS "approvedPrice",
                i.markup::text AS markup,
                i.affiliate_fee::text AS "affiliateFee",
                i.call_center_fee::text AS "callCenterFee",
                i.hidden_delivery::text AS "hiddenDelivery",
                i.platform_service::text AS "platformService"
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
        // BE-18: narx nusxasi (bir dona) — faqat lid buyurtmasida
        priceSnapshot:
          it.approvedPrice == null
            ? null
            : {
                sku: (it.sku as string) ?? null,
                weightGrams: Number(it.weightGrams),
                basePrice: Number(it.basePrice),
                recommendedPrice: Number(it.recommendedPrice),
                approvedPrice: Number(it.approvedPrice),
                markup: Number(it.markup),
                affiliateFee: Number(it.affiliateFee),
                callCenterFee: Number(it.callCenterFee),
                hiddenDelivery: Number(it.hiddenDelivery),
                platformService: Number(it.platformService),
              },
      });
      itemsBySeller.set(key, list);
    }

    // BE-18: lid buyurtmasining holat jurnali (rad etilgan o‘tishlar ham)
    const history = order.source
      ? ((await this.dataSource.query(
          `SELECT from_status AS "fromStatus", to_status AS "toStatus", accepted,
                  actor_type AS "actorType", actor_id::text AS "actorId",
                  actor_role AS "actorRole", reason, created_at AS "createdAt"
             FROM checkout.order_status_history
            WHERE order_id = $1 ORDER BY id`,
          [orderId],
        )) as Array<Record<string, unknown>>)
      : [];
    const money = (v: unknown) => (v == null ? null : Number(v));

    return {
      id: String(order.id),
      buyerName: order.buyerName ?? null,
      // lid buyurtmasida mijoz foydalanuvchi emas (T01:140)
      customerId: order.customerId == null ? null : String(order.customerId),
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
      lead: order.source
        ? {
            source: order.source,
            leadId: order.leadId,
            streamId: order.streamId ?? null,
            affiliateId: order.affiliateId ?? null,
            wholesalerId: order.wholesalerId,
            customerPhone: order.customerPhone,
            regionSoato: order.regionSoato,
            districtSoato: order.districtSoato,
            whereDeliver: order.whereDeliver,
            deliveryMode: order.deliveryMode,
            deliveryShown: money(order.deliveryShown),
            deliveryCost: money(order.deliveryCost),
            deliveryEmbedded: money(order.deliveryEmbedded),
            weightGrams: money(order.weightGrams),
            codAmount: money(order.codAmount),
            confirmedBy: order.confirmedBy ?? null,
            addressConfirmedBy: order.addressConfirmedBy ?? null,
            statusHistory: history,
          }
        : null,
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
        `SELECT id::text,status,payment_method,payment_id::text,total_amount,customer_id::text FROM checkout.sales_order WHERE id=$1 FOR UPDATE`,
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
      // C4.2: qisman qaytarilgan tovar pulini va qoldig'ini to'liq refund
      // ikkinchi marta qaytarib yubormasin — bunday buyurtma qaytarish
      // so'rovlari orqali yakunlanadi.
      const [returns] = (await manager.query(
        `SELECT COUNT(*)::int AS total FROM checkout.return_request
          WHERE sales_order_id=$1 AND status IN ('APPROVED','REFUNDED')`,
        [input.orderId],
      )) as CountRow[];
      if (Number(returns?.total ?? 0) > 0) {
        throw new BadRequestException(
          'Buyurtmada tasdiqlangan qaytarish so‘rovi bor — pulni qaytarish so‘rovlari orqali qaytaring',
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
          shopIds.map((shopId) => shopOwnerUserId(this.catalog!, shopId)),
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
      // `deliveryFee` ATAYLAB qo'shildi: u ham `bigint` ustun, ya'ni
      // node-postgres uni SATR qilib qaytaradi ("0") va javobga shundayligicha
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
