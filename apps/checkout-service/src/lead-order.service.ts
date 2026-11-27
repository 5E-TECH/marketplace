import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  CatalogOrderSnapshot,
  CatalogOrderSnapshotMany,
  CheckoutDeliveryDestination,
  FulfillmentTaskStatus,
  pickDateFor,
  CheckoutPaymentMethod,
  ErrorCode,
  LEAD_EVENTS,
  LEAD_ORDER_RPC,
  LeadConfirmedEvent,
  LeadConfirmedVia,
  LeadOrderStatus,
  LeadSource,
  OrderCreateFailedEvent,
  OrderCreateFailedReason,
  orderCodAmount,
  OutboxService,
  RmqClient,
  runAsLeader,
  sendRpc,
} from '@app/common';
import {
  LeadOrderStatusService,
  SYSTEM_ACTOR,
} from './lead-order-status.service';

const ID = /^[1-9]\d{0,18}$/;
/**
 * BE-34: saytdan bitta buyurtmadagi tovar qatorlari chegarasi — savat qatorlari soni bilan bir xil (lead-service
 * `SITE_ORDER_MAX_LINES`) [taklif].
 */
export const MAX_ORDER_LINES = 50;
const PHONE = /^\+998\d{9}$/;
const SOATO = /^\d{2,20}$/;
/**
 * Ishlov paytida qator boshqa ishchiga berilmaydi. Katalog va ombor so‘rovi 10 s dan, bir urinish ≈ 30 s dan oshmaydi;
 * zaxira bilan — ikkinchi ishchi birinchisi tugamasdan so‘rovni olmasin.
 */
const CLAIM_LEASE_S = 120;
/** Katalog yoki ombor javob bermasa: qayta urinish oralig‘i, soniya [taklif]. */
const RETRY_DELAYS_S = [10, 30, 60, 120, 300];
const TICK_BUDGET_MS = 8_000;
const ALERT_AFTER_ATTEMPTS = 5;

interface RequestRow {
  id: string;
  orderId: string;
  leadId: string;
  payload: LeadConfirmedEvent;
  attempts: number;
}

/**
 * Liddan buyurtma (BE-18, TZ BUY-1, T5 «lead.confirmed → checkout»).
 *
 * `lead.confirmed` avval `lead_order_request` ga yoziladi, keyin darhol ishlanadi; xato bo‘lsa so‘rov qoladi va har
 * 10 soniyada qayta uriniladi — katalog yoki ombor uzoq ishlamasa ham (RabbitMQ qayta urinishi 3 marta bilan
 * cheklangan, BE-02), lid yo‘qolmaydi (YOL-04). Takroriy hodisa ikkinchi buyurtma ochmaydi (TC6): hodisa ID si unikal, bitta lidga bitta faol
 * so‘rov, bitta buyurtma.
 *
 * Buyurtma ID si so‘rov yozilganda olinadi: band qilish shu ID bilan va so‘rov kaliti bilan — qayta urinish ikkinchi
 * band ochmaydi. Band muddatsiz (`ttlMs` yo‘q, TC8): Elchi’ga topshirishda chiqimga aylanadi, bekor qilinsa bo‘shaydi.
 */
@Injectable()
export class LeadOrderService {
  private readonly logger = new Logger(LeadOrderService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly status: LeadOrderStatusService,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
  ) {}

  /**
   * `lead.confirmed` qabul qiluvchisi. So‘rov yozilgach xato tashlamaydi — muammo so‘rov qatorida qoladi va o‘z
   * qayta urinishi bilan ishlanadi. So‘rovni yozib bo‘lmasa (baza) — xato RabbitMQ qayta urinishiga (BE-02).
   */
  async onLeadConfirmed(
    event: LeadConfirmedEvent,
  ): Promise<{ accepted: boolean; requestId?: string }> {
    const leadId = String(event?.leadId ?? '');
    const eventId = String(event?.eventId ?? '');
    if (!ID.test(leadId) || !eventId || eventId.length > 200) {
      this.logger.error(
        `lead.confirmed rad etildi: lid yoki hodisa ID si noto‘g‘ri (${leadId || '—'})`,
      );
      return { accepted: false };
    }
    const problem = invalidReason(event);
    if (problem) {
      // Lid yo‘qolmasin: so‘rov FAILED, lid sababi bilan navbatga qaytadi
      const failed = await this.dataSource.transaction(async (manager) => {
        const rows = await this.insertRequest(
          manager,
          event,
          'FAILED',
          problem,
        );
        if (rows.length)
          await this.recordCreateFailed(
            manager,
            leadId,
            OrderCreateFailedReason.INVALID_ORDER,
          );
        return rows;
      });
      this.logger.error(`Lid ${leadId}: buyurtma yaratilmadi — ${problem}`);
      return { accepted: false, requestId: failed[0]?.id };
    }
    const [row] = await this.insertRequest(
      this.dataSource.manager,
      event,
      'PENDING',
      null,
    );
    if (!row) return { accepted: false }; // takroriy hodisa yoki lidning faol so‘rovi bor
    const claimed = await this.claim(row.id);
    if (claimed) await this.processSafely(claimed);
    return { accepted: true, requestId: row.id };
  }

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'lead-order-worker',
    waitForCompletion: true,
  })
  async processDueTick(): Promise<void> {
    await runAsLeader(this.dataSource, 'lead-order-worker', () =>
      this.processDue(),
    );
  }

  /** Vaqti kelgan so‘rovlarni birma-bir ishlaydi. */
  async processDue(limit = 20): Promise<number> {
    const started = Date.now();
    let handled = 0;
    while (handled < limit && Date.now() - started < TICK_BUDGET_MS) {
      const row = await this.claim();
      if (!row) break;
      await this.processSafely(row);
      handled++;
    }
    return handled;
  }

  private async processSafely(row: RequestRow): Promise<void> {
    try {
      await this.process(row);
    } catch (error) {
      // Kutilmagan xato (baza): so‘rov keyinga suriladi, navbatni to‘sib qo‘ymaydi
      await this.retryLater(row, (error as Error).message);
    }
  }

  private async process(row: RequestRow): Promise<void> {
    const event = row.payload;
    const lines = orderLines(event);
    let snapshots: Array<CatalogOrderSnapshot | null>;
    let delivery: CatalogOrderSnapshot['delivery'] | null;
    try {
      if (lines.length === 1) {
        const snapshot = await sendRpc<CatalogOrderSnapshot | null>(
          this.catalog,
          { cmd: LEAD_ORDER_RPC.CATALOG_SNAPSHOT },
          {
            productId: lines[0].productId,
            quantity: lines[0].quantity,
            whereDeliver: event.whereDeliver,
          },
        );
        snapshots = [snapshot];
        delivery = snapshot?.delivery ?? null;
      } else {
        // BE-34: saytdan ko‘p tovarli lid — yetkazish butun posilka og‘irligi bo‘yicha
        const many = await sendRpc<CatalogOrderSnapshotMany>(
          this.catalog,
          { cmd: LEAD_ORDER_RPC.CATALOG_SNAPSHOT_MANY },
          {
            items: lines.map(({ productId, quantity }) => ({
              productId,
              quantity,
            })),
            whereDeliver: event.whereDeliver,
          },
        );
        snapshots = lines.map((_, index) => many?.items?.[index] ?? null);
        delivery = many?.delivery ?? null;
      }
    } catch (error) {
      if (isPermanent(error, [400, 404]))
        return this.fail(
          row,
          OrderCreateFailedReason.OFFER_UNAVAILABLE,
          `katalog: ${messageOf(error)}`,
        );
      return this.retryLater(row, `katalog: ${messageOf(error)}`);
    }
    for (const [index, snapshot] of snapshots.entries()) {
      const unavailable = offerProblem(snapshot);
      if (unavailable)
        return this.fail(
          row,
          OrderCreateFailedReason.OFFER_UNAVAILABLE,
          lines.length > 1
            ? `mahsulot ${lines[index].productId}: ${unavailable}`
            : unavailable,
        );
      const priceChanged = priceProblem(snapshot!, lines[index].salePrice);
      if (priceChanged)
        return this.fail(
          row,
          OrderCreateFailedReason.PRICE_CHANGED,
          lines.length > 1
            ? `mahsulot ${lines[index].productId}: ${priceChanged}`
            : priceChanged,
        );
    }
    if (!delivery)
      return this.fail(
        row,
        OrderCreateFailedReason.OFFER_UNAVAILABLE,
        'Posilka yetkazishi hisoblanmadi',
      );
    const parts = lines.map((line, index) => ({
      line,
      offer: snapshots[index]!,
    }));

    try {
      // TC8: `ttlMs` yo‘q — band muddatsiz, sweeper bo‘shatmaydi. BE-34: hamma qator bitta so‘rovda — bittasi band
      // bo‘lmasa hech biri band qilinmaydi (TC10)
      await sendRpc(
        this.inventory,
        { cmd: 'inventory.reserve' },
        {
          orderRef: row.orderId,
          items: parts.map(({ line, offer }) => ({
            variantId: offer.variantId,
            quantity: line.quantity,
          })),
          idempotencyKey: `lead-order:${row.id}`,
        },
      );
    } catch (error) {
      if (errorCodeOf(error) === ErrorCode.INSUFFICIENT_STOCK)
        return this.fail(
          row,
          OrderCreateFailedReason.OUT_OF_STOCK,
          'Qoldiq yetarli emas',
        );
      if (isPermanent(error, [400, 404]))
        return this.fail(
          row,
          OrderCreateFailedReason.INVALID_ORDER,
          `ombor: ${messageOf(error)}`,
        );
      return this.retryLater(row, `ombor: ${messageOf(error)}`);
    }
    await this.create(row, parts, delivery);
  }

  /**
   * Buyurtma, posilka qatori, tovar qatorlari (narx nusxasi), jurnal va `order.status.changed` — bitta tranzaksiyada.
   * BE-34: saytdan ko‘p tovarli lid — bitta buyurtma, bitta posilka, har tovar o‘z qatori va optovigi bilan.
   */
  private async create(
    row: RequestRow,
    parts: Array<{ line: OrderLine; offer: CatalogOrderSnapshot }>,
    delivery: CatalogOrderSnapshot['delivery'],
  ) {
    const event = row.payload;
    const goods = parts.reduce(
      (sum, { line }) => sum + line.salePrice * line.quantity,
      0,
    );
    const deliveryShown = delivery.shown;
    const cod = orderCodAmount({
      items: parts.map(({ line }) => ({
        unitPrice: line.salePrice,
        quantity: line.quantity,
      })),
      deliveryFee: deliveryShown,
    });
    const embedded = parts.reduce(
      (sum, { line, offer }) => sum + offer.hiddenDelivery * line.quantity,
      0,
    );
    const weight = parts.reduce(
      (sum, { line, offer }) => sum + offer.weightGrams * line.quantity,
      0,
    );
    const quantity = parts.reduce((sum, { line }) => sum + line.quantity, 0);
    // posilka va buyurtma optovigi — birinchi qator; har qatorning o‘z optovigi `sales_order_item.wholesaler_id` da
    const wholesalerId = parts[0].offer.wholesalerId;
    await this.dataSource.transaction(async (manager) => {
      const [request] = (await manager.query(
        `SELECT status FROM checkout.lead_order_request WHERE id = $1 FOR UPDATE`,
        [row.id],
      )) as Array<{ status: string }>;
      if (request?.status !== 'PENDING') return;
      await manager.query(
        `INSERT INTO checkout.sales_order
           (id, customer_id, buyer_name, status, payment_method, total_amount, delivery_fee,
            delivery_address, where_deliver, source, lead_id, stream_id, affiliate_id, wholesaler_id,
            customer_phone, region_soato, district_soato, delivery_mode, delivery_shown, delivery_cost,
            delivery_embedded, weight_grams, cod_amount, confirmed_by, address_confirmed_by, confirmed_via,
            delivery_shown_other)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
        [
          row.orderId,
          event.customerName.trim(),
          LeadOrderStatus.CONFIRMED,
          CheckoutPaymentMethod.COD,
          cod,
          deliveryShown,
          // faqat ko‘cha/uy — telefon alohida ustunda
          event.addressLine.trim(),
          event.whereDeliver,
          event.source,
          event.leadId,
          event.streamId,
          event.affiliateId,
          wholesalerId,
          event.customerPhone,
          event.regionSoato,
          event.districtSoato,
          delivery.mode,
          deliveryShown,
          delivery.elchiTariff,
          embedded,
          weight,
          cod,
          event.confirmedBy ?? null,
          event.addressConfirmedBy,
          event.confirmedVia ?? LeadConfirmedVia.OPERATOR,
          // FE-26: tanlanmagan tur (eski katalog javobida yo‘q — NULL)
          delivery.shownOther ?? null,
        ],
      );
      const [seller] = (await manager.query(
        `INSERT INTO checkout.parcel
           (sales_order_id, shop_id, subtotal, cod_amount, delivery_fee, status, elchi_state)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', 'PENDING') RETURNING id::text AS id`,
        [row.orderId, wholesalerId, goods, cod, deliveryShown],
      )) as Array<{ id: string }>;
      for (const { line, offer } of parts) {
        // TC11: tasdiqlangan narx va ustama alohida (sotuv ≥ tasdiqlangan — `priceProblem` tekshirgan)
        const approvedPrice = offer.approvedPrice!;
        await manager.query(
          `INSERT INTO checkout.sales_order_item
             (sales_order_seller_id, product_id, product_name, variant_id, quantity, unit_price,
              line_total, sku, weight_grams, base_price, recommended_price, approved_price, markup,
              affiliate_fee, call_center_fee, hidden_delivery, platform_service, barcode, wholesaler_id,
              mxik_code, package_code, wholesaler_tin)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                   $20, $21, $22)`,
          [
            seller.id,
            offer.productId,
            offer.productName,
            offer.variantId,
            line.quantity,
            line.salePrice,
            line.salePrice * line.quantity,
            offer.sku,
            offer.weightGrams,
            offer.basePrice,
            offer.recommendedPrice,
            approvedPrice,
            line.salePrice - approvedPrice,
            offer.affiliateFee,
            offer.callCenterFee,
            offer.hiddenDelivery,
            offer.platformService,
            offer.barcode?.trim() || null,
            offer.wholesalerId,
            // BE-41: fiskal chek nusxasi (katalog eski bo‘lsa `fiscal` yo‘q — null)
            offer.fiscal?.mxikCode ?? null,
            offer.fiscal?.packageCode ?? null,
            offer.fiscal?.wholesalerTin ?? null,
          ],
        );
      }
      // BE-19: yig‘ish vazifasi; kun — operator tasdiqlagan vaqtdan (14:00 chegarasi, OMB-4)
      await manager.query(
        `INSERT INTO checkout.fulfillment_task
           (order_id, parcel_id, status, pick_date, required_qty)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          row.orderId,
          seller.id,
          FulfillmentTaskStatus.TO_PICK,
          pickDateFor(confirmedAtOf(event)),
          quantity,
        ],
      );
      await this.status.journal(
        manager,
        row.orderId,
        null,
        LeadOrderStatus.CONFIRMED,
        true,
        SYSTEM_ACTOR,
        `Liddan yaratildi (lid ${event.leadId})`,
      );
      await this.status.emit(
        manager,
        row.orderId,
        null,
        LeadOrderStatus.CONFIRMED,
      );
      await manager.query(
        `UPDATE checkout.lead_order_request
            SET status = 'DONE', last_error = NULL, updated_at = now()
          WHERE id = $1`,
        [row.id],
      );
    });
  }

  private insertRequest(
    manager: EntityManager,
    event: LeadConfirmedEvent,
    status: 'PENDING' | 'FAILED',
    error: string | null,
  ): Promise<Array<{ id: string }>> {
    // ON CONFLICT nishonsiz: hodisa ID si, buyurtma ID si va lidning faol so‘rovi — uchalasi ham takrorni to‘xtatadi
    return manager.query(
      `INSERT INTO checkout.lead_order_request
         (event_id, lead_id, order_id, payload, status, failure_reason, last_error)
       VALUES ($1, $2, nextval(pg_get_serial_sequence('checkout.sales_order', 'id')),
               $3::jsonb, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING id::text AS id`,
      [
        String(event.eventId),
        String(event.leadId),
        JSON.stringify(event),
        status,
        status === 'FAILED' ? OrderCreateFailedReason.INVALID_ORDER : null,
        error,
      ],
    ) as Promise<Array<{ id: string }>>;
  }

  /** Vaqti kelgan so‘rovni oladi va lease bilan band qiladi (bitta so‘rov — atomar). */
  private async claim(id?: string): Promise<RequestRow | undefined> {
    const result = (await this.dataSource.query(
      `WITH next AS (
         SELECT id FROM checkout.lead_order_request
          WHERE status = 'PENDING' AND next_attempt_at <= clock_timestamp()
            AND ($1::bigint IS NULL OR id = $1::bigint)
          ORDER BY next_attempt_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE checkout.lead_order_request r
          SET next_attempt_at = clock_timestamp() + make_interval(secs => $2),
              updated_at = now()
         FROM next
        WHERE r.id = next.id
       RETURNING r.id::text AS id, r.order_id::text AS "orderId", r.lead_id::text AS "leadId",
                 r.payload, r.attempts`,
      [id ?? null, CLAIM_LEASE_S],
    )) as unknown[];
    return returnedRows<RequestRow>(result)[0];
  }

  private async retryLater(row: RequestRow, message: string): Promise<void> {
    const delay =
      RETRY_DELAYS_S[Math.min(row.attempts, RETRY_DELAYS_S.length - 1)];
    const text = `Lid ${row.leadId}: buyurtma yaratilmadi (${row.attempts + 1}-urinish), ${delay} s dan keyin qayta: ${message}`;
    // 5 urinishdan keyin (≈ 4 daqiqa) — xato darajasida: lid tasdiqlangan, lekin buyurtmasiz turibdi
    if (row.attempts + 1 >= ALERT_AFTER_ATTEMPTS) this.logger.error(text);
    else this.logger.warn(text);
    await this.dataSource.query(
      `UPDATE checkout.lead_order_request
          SET attempts = attempts + 1,
              next_attempt_at = clock_timestamp() + make_interval(secs => $2),
              last_error = $3, updated_at = now()
        WHERE id = $1 AND status = 'PENDING'`,
      [row.id, delay, message],
    );
  }

  /** Buyurtma yaratilmaydi: so‘rov FAILED, lid sababi bilan navbatga qaytadi (`order.create-failed`, TC9). */
  private async fail(
    row: RequestRow,
    reason: OrderCreateFailedReason,
    message: string,
  ): Promise<void> {
    // Oldingi urinishda band ochilgan bo‘lishi mumkin (javob yo‘qolgan, keyin offer sotuvdan olingan): muddatsiz band
    // abadiy qolmasin. Band yo‘q yoki allaqachon bo‘sh — ombor 4xx qaytaradi; ombor javob bermasa — keyinroq.
    try {
      await sendRpc(
        this.inventory,
        { cmd: 'inventory.release' },
        {
          orderRef: row.orderId,
          idempotencyKey: `lead-order-fail:${row.id}`,
          reason: `Buyurtma yaratilmadi: ${message}`.slice(0, 500),
        },
      );
    } catch (error) {
      if (!isPermanent(error))
        return this.retryLater(
          row,
          `bandni bo‘shatib bo‘lmadi: ${messageOf(error)}`,
        );
    }
    this.logger.warn(`Lid ${row.leadId}: buyurtma yaratilmadi — ${message}`);
    await this.dataSource.transaction(async (manager) => {
      const updated = returnedRows(
        (await manager.query(
          `UPDATE checkout.lead_order_request
              SET status = 'FAILED', failure_reason = $2, last_error = $3, updated_at = now()
            WHERE id = $1 AND status = 'PENDING'
          RETURNING id`,
          [row.id, reason, message],
        )) as unknown[],
      );
      if (updated.length)
        await this.recordCreateFailed(manager, row.leadId, reason);
    });
  }

  private async recordCreateFailed(
    manager: EntityManager,
    leadId: string,
    reason: OrderCreateFailedReason,
  ): Promise<void> {
    const payload: OrderCreateFailedEvent = {
      eventId: randomUUID(),
      leadId,
      reason,
      at: new Date().toISOString(),
    };
    await this.outbox.record(
      {
        aggregateType: 'lead',
        aggregateId: leadId,
        eventType: LEAD_EVENTS.ORDER_CREATE_FAILED,
        payload: payload as unknown as Record<string, unknown>,
      },
      manager,
    );
  }
}

/** Hodisa maydonlari (BE-13 `LeadConfirmedEvent`) — buyurtma va Elchi uchun yetarli va to‘g‘rimi. */
export function invalidReason(event: LeadConfirmedEvent): string | null {
  const optionalId = (v: unknown) => v == null || ID.test(String(v));
  if (!Object.values(LeadSource).includes(event.source))
    return `manba noto‘g‘ri: ${String(event.source)}`;
  if (!ID.test(String(event.productId ?? '')))
    return 'mahsulot ID si noto‘g‘ri';
  if (
    !Number.isSafeInteger(event.quantity) ||
    event.quantity < 1 ||
    event.quantity > 1000
  )
    return `miqdor noto‘g‘ri: ${String(event.quantity)}`;
  if (!Number.isSafeInteger(event.salePrice) || event.salePrice <= 0)
    return `narx noto‘g‘ri: ${String(event.salePrice)}`;
  if (!optionalId(event.streamId) || !optionalId(event.affiliateId))
    return 'sahifa yoki sotuvchi ID si noto‘g‘ri';
  // Asosiy saytdan boshqa manbada sotuvchi majburiy (moliya: sotuvchi haqi kimga yoziladi)
  if (event.source !== LeadSource.SITE && event.affiliateId == null)
    return 'sotuvchi yo‘q';
  const name = String(event.customerName ?? '').trim();
  if (!name || name.length > 255) return 'mijoz ismi noto‘g‘ri';
  if (!PHONE.test(String(event.customerPhone ?? '')))
    return 'telefon noto‘g‘ri';
  if (
    !SOATO.test(String(event.regionSoato ?? '')) ||
    !SOATO.test(String(event.districtSoato ?? ''))
  )
    return 'viloyat yoki tuman (SOATO) noto‘g‘ri';
  const address = String(event.addressLine ?? '').trim();
  if (!address || address.length > 1000) return 'manzil noto‘g‘ri';
  if (!Object.values(CheckoutDeliveryDestination).includes(event.whereDeliver))
    return 'yetkazish turi noto‘g‘ri';
  // BE-34: SMS havola bilan mijoz tasdiqlaydi — operator yo‘q; faqat asosiy sayt lidi
  const via = event.confirmedVia ?? LeadConfirmedVia.OPERATOR;
  if (!Object.values(LeadConfirmedVia).includes(via))
    return `tasdiqlash usuli noto‘g‘ri: ${String(via)}`;
  if (via === LeadConfirmedVia.SMS && event.source !== LeadSource.SITE)
    return 'SMS bilan faqat saytdan buyurtma tasdiqlanadi';
  if (
    (via === LeadConfirmedVia.SMS
      ? !optionalId(event.confirmedBy)
      : !ID.test(String(event.confirmedBy ?? ''))) ||
    !optionalId(event.addressConfirmedBy)
  )
    return 'tasdiqlagan operator ID si noto‘g‘ri';
  if (event.items !== undefined) {
    if (event.source !== LeadSource.SITE)
      return 'bir nechta tovar faqat saytdan buyurtmada';
    if (!Array.isArray(event.items) || !event.items.length)
      return 'tovar qatorlari bo‘sh';
    if (event.items.length > MAX_ORDER_LINES)
      return `tovar qatorlari ko‘p: ${event.items.length}`;
    const seen = new Set<string>();
    for (const item of event.items) {
      if (!ID.test(String(item?.productId ?? '')))
        return 'qatorda mahsulot ID si noto‘g‘ri';
      if (seen.has(String(item.productId)))
        return `mahsulot takrorlangan: ${String(item.productId)}`;
      seen.add(String(item.productId));
      if (
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 1000
      )
        return `qatorda miqdor noto‘g‘ri: ${String(item.quantity)}`;
      if (!Number.isSafeInteger(item.salePrice) || item.salePrice <= 0)
        return `qatorda narx noto‘g‘ri: ${String(item.salePrice)}`;
    }
    const [first] = event.items;
    if (
      String(first.productId) !== String(event.productId) ||
      first.quantity !== event.quantity ||
      first.salePrice !== event.salePrice
    )
      return 'birinchi qator lid mahsulotiga mos emas';
  }
  return null;
}

/** Buyurtma qatorlari: saytdan ko‘p tovarli lid (BE-34) — `items`, aks holda bitta tovar. */
export interface OrderLine {
  productId: string;
  quantity: number;
  salePrice: number;
}

export function orderLines(event: LeadConfirmedEvent): OrderLine[] {
  return event.items?.length
    ? event.items.map(({ productId, quantity, salePrice }) => ({
        productId: String(productId),
        quantity,
        salePrice,
      }))
    : [
        {
          productId: String(event.productId),
          quantity: event.quantity,
          salePrice: event.salePrice,
        },
      ];
}

/**
 * Sahifa narxi tasdiqlangan narxdan past (lid kelgandan keyin admin narxni oshirgan) yoki platforma xizmati manfiy —
 * buyurtma yaratilmaydi: moliya taqsimoti (BE-22) bunday buyurtmani yetkazilganda rad etadi. Lid navbatga qaytadi,
 * operator yangi narxni aytadi [taklif].
 */
export function priceProblem(
  offer: CatalogOrderSnapshot,
  salePrice: number,
): string | null {
  if (salePrice < offer.approvedPrice!)
    return `Sahifa narxi (${salePrice}) tasdiqlangan narxdan (${offer.approvedPrice}) past`;
  if (offer.platformService < 0)
    return `Platforma xizmati manfiy: ${offer.platformService}`;
  return null;
}

/** Operator «Tasdiqlandi» ni bosgan vaqt; noto‘g‘ri bo‘lsa — hozir. */
function confirmedAtOf(event: LeadConfirmedEvent): Date {
  const at = new Date(event.confirmedAt);
  return Number.isNaN(at.getTime()) ? new Date() : at;
}

/** Katalog javobi buyurtma uchun yaroqlimi; yo‘q bo‘lsa — sabab. */
export function offerProblem(
  offer: CatalogOrderSnapshot | null,
): string | null {
  if (!offer) return 'Mahsulot topilmadi';
  if (offer.withdrawn) return 'Mahsulot sotuvdan olingan';
  if (!offer.cpaAvailable) return 'Mahsulot sotuvchilarga ochiq emas';
  if (offer.approvedPrice == null) return 'Narx tasdiqlanmagan';
  if (!offer.variantId) return 'Mahsulotning faol varianti yo‘q';
  if (!Number.isSafeInteger(offer.weightGrams) || offer.weightGrams <= 0)
    return 'Mahsulot og‘irligi yo‘q';
  return null;
}

/**
 * Postgres drayveri `UPDATE ... RETURNING` uchun `[qatorlar, soni]`, `INSERT`/`SELECT` uchun qatorlarni qaytaradi
 * (`seller-orders.service.ts` `updateStatus` izohi).
 */
function returnedRows<T = unknown>(result: unknown[]): T[] {
  return (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
      ? result[0]
      : result
  ) as T[];
}

function statusOf(error: unknown): number | null {
  return error instanceof HttpException ? error.getStatus() : null;
}

/** 4xx — qayta urinish yordam bermaydi (408/429 dan tashqari); `only` berilsa — faqat shu kodlar. */
function isPermanent(error: unknown, only?: number[]): boolean {
  const status = statusOf(error);
  if (status == null || status >= 500 || status === 408 || status === 429)
    return false;
  return only ? only.includes(status) : true;
}

function errorCodeOf(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse() as { errorCode?: string } | string;
  return typeof response === 'object' ? (response.errorCode ?? null) : null;
}

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error);
}
