import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import {
  CheckoutDeliveryDestination,
  ElchiParcelCancelResultEvent,
  ElchiParcelCreatedEvent,
  ElchiParcelFailedEvent,
  LeadOrderStatus,
  ORDER_EVENTS,
  OrderStatusChangedEvent,
  OutboxService,
  elchiOrderRef,
  processOnce,
  runAsLeader,
} from '@app/common';
import { ElchiApiClient, ElchiApiError } from './elchi-api.client';
import { ElchiIntegrationService } from './elchi-integration.service';

export type ParcelStatus =
  'PENDING' | 'CREATED' | 'FAILED' | 'CANCEL_PENDING' | 'CANCELLED';

interface ParcelRow {
  id: string;
  orderId: string;
  status: ParcelStatus;
  payload: OrderStatusChangedEvent;
  shipmentId: string | null;
  attempts: number;
  /** Oxirgi Elchi ga yaratish so'rovi yaqinda bo'lganmi (javobi kelmagan bo'lishi mumkin). */
  createRecent: boolean;
}

/**
 * Qayta urinish oralig'i, soniya [taklif]: 30 s, 1, 2, 4 daqiqa, keyin har
 * 5 daqiqa — cheksiz. Elchi ishlamasa buyurtma navbatda kutadi (BE-20 TC2).
 * `bumpAfterCrash` dagi SQL massiv shu qiymatlar bilan bir xil.
 */
const RETRY_DELAYS_S = [30, 60, 120, 240, 300];

/**
 * Qayta urinish foyda bermaydigan Elchi javoblari: so'rovning o'zi xato.
 * 401/403/404 bu yerda yo'q — ular sozlama xatosi (kalit, market, manzil) va
 * tuzatilgach o'tadi; navbatdagi buyurtmalar yo'qolmasin.
 */
const REJECT_STATUSES = new Set([400, 422]);

/** Elchi og'irlik chegarasi: 0.001–1000 kg (Elchi-Backend `product-measure.ts`). */
const MAX_WEIGHT_GRAMS = 1_000_000;

/** Bitta ishchi urishining vaqt chegarasi [taklif]: yetakchi tranzaksiyasi uzoq ochiq qolmasin. */
const TICK_BUDGET_MS = 60_000;

/**
 * Javobi kelmagan yaratishdan keyin Elchi posilkani hali yaratayotgan bo'lishi
 * mumkin (gateway 65 s kutadi). Shu vaqt ichida «topilmadi» (404) ga
 * ishonilmaydi — bekor qilish qayta uriniladi [taklif: 65 s + zaxira].
 */
const CREATE_SETTLE_S = 120;

/** Geo kesh tuman topilmaganda bir daqiqada ko'pi bilan bir marta yangilanadi [taklif]. */
const GEO_SYNC_INTERVAL_MS = 60_000;

const CONSUMER = 'elchi-parcel';

/**
 * BE-20: Elchi posilkasi buyurtma tranzaksiyasidan tashqarida, navbat orqali.
 *
 * 1. `order.status.changed` («Tasdiqlandi») → `parcel_request` qatori
 *    (buyurtma bo'yicha bitta, takroriy hodisa ikkinchisini yaratmaydi).
 * 2. Ishchi (cron, yetakchi qulf bilan) navbatdagi qatorni oladi va Elchi
 *    platforma marketida posilka yaratadi; natija `elchi.parcel.created`
 *    bilan outbox orqali checkout ga qaytadi (BE-19 yozadi).
 * 3. «Bekor qilindi» → Elchi ga hali yuborilmagan bo'lsa navbatdan chiqadi;
 *    yuborilgan bo'lsa (yaratilgan yoki javobi kelmagan) Elchi da bekor
 *    qilinadi — idempotent.
 *
 * Elchi ga buyurtma `mp-order:<orderId>` bilan boradi: eski har-do'kon yo'li
 * (`integration.shipment.create`, BE-18 gacha o'zgarmaydi) raqamli
 * `sales_order_seller.id` yuboradi va kalitlar to'qnashmaydi.
 */
@Injectable()
export class ParcelService {
  private readonly logger = new Logger(ParcelService.name);
  private lastGeoSyncAttemptAt = 0;
  private lastGeoSyncOkAt = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly elchi: ElchiApiClient,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly geo: ElchiIntegrationService,
  ) {}

  /** `order.status.changed` qabul qiluvchisi. */
  async onOrderStatusChanged(
    event: OrderStatusChangedEvent,
  ): Promise<{ duplicate: boolean }> {
    if (!event?.eventId || !event?.orderId || !event?.status) {
      throw new BadRequestException(
        'order.status.changed: eventId, orderId va status majburiy',
      );
    }
    const handled = await processOnce(
      this.dataSource,
      {
        table: 'integration.processed_event',
        consumer: CONSUMER,
        eventId: event.eventId,
      },
      async (manager) => {
        if (event.status === LeadOrderStatus.CONFIRMED) {
          const problem = this.invalidReason(event);
          if (problem) await this.rejectEvent(manager, event, problem);
          else await this.enqueue(manager, event);
        } else if (event.status === LeadOrderStatus.CANCELLED) {
          await this.requestCancel(manager, event);
        }
      },
    );
    return { duplicate: handled.duplicate };
  }

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'elchi-parcel-worker',
    waitForCompletion: true,
  })
  async processDueTick(): Promise<void> {
    await runAsLeader(this.dataSource, 'elchi-parcel-worker', () =>
      this.processDue(),
    );
  }

  /** Vaqti kelgan navbat qatorlarini birma-bir ishlaydi. */
  async processDue(limit = 20): Promise<number> {
    const started = Date.now();
    let handled = 0;
    while (handled < limit && Date.now() - started < TICK_BUDGET_MS) {
      let current: ParcelRow | undefined;
      try {
        const done = await this.dataSource.transaction(async (manager) => {
          const [row] = (await manager.query(
            `SELECT id::text, order_id AS "orderId", status, payload,
                    shipment_id AS "shipmentId", attempts,
                    COALESCE(last_create_at > now() - make_interval(secs => ${CREATE_SETTLE_S}), false)
                      AS "createRecent"
               FROM integration.parcel_request
              WHERE status IN ('PENDING','CANCEL_PENDING')
                AND next_attempt_at <= now()
              ORDER BY next_attempt_at, id
              LIMIT 1
              FOR UPDATE SKIP LOCKED`,
          )) as ParcelRow[];
          if (!row) return false;
          current = row;
          if (row.status === 'PENDING') await this.create(manager, row);
          else await this.cancel(manager, row);
          return true;
        });
        if (!done) break;
      } catch (error) {
        // Kutilmagan xato (baza, ma'lumot): qator navbat boshini to'sib
        // qo'ymasin — urinish yoziladi va keyinga suriladi.
        if (!current) throw error;
        await this.bumpAfterCrash(current, error as Error);
      }
      handled++;
    }
    return handled;
  }

  private async enqueue(
    manager: EntityManager,
    event: OrderStatusChangedEvent,
  ): Promise<void> {
    // order_id UNIQUE: «Tasdiqlandi» ikki marta kelsa ham bitta posilka (TC1).
    // Faqat FAILED qator qayta jonlanadi (yangi «Tasdiqlandi» — qayta yuborish).
    await manager.query(
      `INSERT INTO integration.parcel_request (order_id, payload)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (order_id) DO UPDATE
         SET status = 'PENDING', payload = EXCLUDED.payload, attempts = 0,
             next_attempt_at = now(), last_error = NULL, updated_at = now()
       WHERE parcel_request.status = 'FAILED'`,
      [String(event.orderId), JSON.stringify(event)],
    );
  }

  /** To'liq bo'lmagan «Tasdiqlandi»: FAILED qator va `elchi.parcel.failed`. */
  private async rejectEvent(
    manager: EntityManager,
    event: OrderStatusChangedEvent,
    message: string,
  ): Promise<void> {
    this.logger.warn(`Buyurtma ${event.orderId}: ${message}`);
    const [row] = (await manager.query(
      `INSERT INTO integration.parcel_request (order_id, status, payload, last_error)
       VALUES ($1, 'FAILED', $2::jsonb, $3)
       ON CONFLICT (order_id) DO UPDATE
         SET payload = EXCLUDED.payload, last_error = EXCLUDED.last_error,
             updated_at = now()
       WHERE parcel_request.status = 'FAILED'
       RETURNING id::text`,
      [String(event.orderId), JSON.stringify(event), message],
    )) as Array<{ id: string }>;
    // Ishlanayotgan yoki yaratilgan qator (avvalgi to'g'ri hodisa) o'zgarmaydi;
    // FAILED qatorga yangi noto'g'ri tasdiq ham xabar beradi.
    if (!row) return;
    await this.recordFailed(manager, String(event.orderId), event.eventId, {
      reason: 'INVALID_EVENT',
      message,
    });
  }

  /**
   * «Bekor qilindi»:
   *  - qator bo'lmasa CANCELLED belgisi qoladi: biz «Tasdiqlandi» ni
   *    ko'rmaganmiz, Elchi ga hech narsa ketmagan; kechikkan «Tasdiqlandi»
   *    posilka yaratmaydi;
   *  - FAILED va yaratish so'rovi hech yuborilmagan → CANCELLED;
   *  - qolgan hammasi (PENDING, CREATED, so'rov yuborilgan FAILED) →
   *    CANCEL_PENDING: Elchi da bekor qilinadi.
   * PENDING ni ham Elchi orqali bekor qilamiz: ishchining tranzaksiyasi Elchi
   * posilkani yaratgandan keyin rollback bo'lsa (jarayon o'ldi, ulanish
   * uzildi), `last_create_at` belgisi ham qaytadi — u «yuborilmagan»
   * degani emas. `last_create_at` shu yerda qo'yiladi, shunda 120 s ichidagi
   * 404 ga ishonilmaydi.
   */
  private async requestCancel(
    manager: EntityManager,
    event: OrderStatusChangedEvent,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO integration.parcel_request (order_id, status, payload)
       VALUES ($1, 'CANCELLED', $2::jsonb)
       ON CONFLICT (order_id) DO UPDATE
         SET status = CASE
               WHEN parcel_request.status = 'FAILED'
                    AND parcel_request.last_create_at IS NULL THEN 'CANCELLED'
               WHEN parcel_request.status IN ('PENDING','CREATED','FAILED')
                    THEN 'CANCEL_PENDING'
               ELSE parcel_request.status
             END,
             last_create_at = CASE
               WHEN parcel_request.status = 'PENDING'
                 THEN COALESCE(parcel_request.last_create_at, clock_timestamp())
               ELSE parcel_request.last_create_at
             END,
             next_attempt_at = now(),
             updated_at = now()`,
      [String(event.orderId), JSON.stringify(event)],
    );
  }

  private async create(manager: EntityManager, row: ParcelRow): Promise<void> {
    const event = row.payload;
    let geo = await this.resolveGeo(manager, event);
    if (!geo) {
      const sync = await this.refreshGeoCache();
      if (sync === 'fresh') geo = await this.resolveGeo(manager, event);
      if (!geo && sync === 'unavailable') {
        // Kesh yangilanmadi — tuman yo'qligiga ishonib bo'lmaydi.
        await this.retryLater(manager, row, 'Geo kesh yangilanmadi');
        return;
      }
    }
    if (!geo) {
      const message = `Tuman topilmadi: SOATO ${event.recipient.districtSoato} (viloyat ${event.recipient.regionSoato})`;
      this.logger.warn(`Buyurtma ${row.orderId}: ${message}`);
      await this.fail(manager, row, 'DISTRICT_NOT_FOUND', message);
      return;
    }
    const marketId = this.config.get<string>('ELCHI_PLATFORM_MARKET_ID');
    if (!marketId) {
      // Sozlama yo'q — posilka navbatda kutadi va logga tushadi.
      await this.retryLater(
        manager,
        row,
        'ELCHI_PLATFORM_MARKET_ID sozlanmagan',
      );
      return;
    }
    await manager.query(
      `UPDATE integration.parcel_request SET last_create_at = clock_timestamp() WHERE id = $1`,
      [row.id],
    );
    // try faqat Elchi chaqiruvini o'raydi: bazaga yozishdagi xato tranzaksiyani
    // bekor qiladi va qator `bumpAfterCrash` bilan qayta uriniladi (Elchi
    // takroriy so'rovga o'sha posilkani qaytaradi). Aks holda posilka CREATED
    // bo'lib, `elchi.parcel.created` yozilmay qolardi.
    let result: Awaited<ReturnType<ElchiApiClient['createShipment']>>;
    try {
      result = await this.elchi.createShipment({
        external_order_id: elchiOrderRef(String(row.orderId)),
        elchi_market_id: marketId,
        customer: {
          name: event.recipient.name,
          phone: event.recipient.phone,
        },
        address: event.recipient.addressLine,
        region_id: geo.regionId,
        district_id: geo.districtId,
        where_deliver:
          event.recipient.whereDeliver === CheckoutDeliveryDestination.CENTER
            ? 'center'
            : 'address',
        items: event.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          external_product_id: String(item.productId),
          ...(item.weightGrams ? { weight_kg: item.weightGrams / 1000 } : {}),
        })),
        cod_amount: event.codAmount,
      });
    } catch (error) {
      if (
        error instanceof ElchiApiError &&
        error.status === 409 &&
        error.code === 'ORDER_INTAKE_CLOSED'
      ) {
        // Bugungi qabul yopiq: Elchi kalitni band qilmaydi, `reopens_at` dan
        // keyin o'sha external_order_id ishlaydi (Elchi-Backend
        // integration-service `requestPartnerOrderCreate`).
        await this.retryLater(manager, row, error.message, error.reopensAt);
        return;
      }
      if (
        error instanceof ElchiApiError &&
        (REJECT_STATUSES.has(error.status) || error.status === 409)
      ) {
        this.logger.warn(`Buyurtma ${row.orderId}: ${error.message}`);
        await this.fail(manager, row, 'ELCHI_REJECTED', error.message);
        return;
      }
      await this.retryLater(manager, row, (error as Error).message);
      return;
    }
    const toBePaid =
      result.to_be_paid === undefined || !Number.isFinite(result.to_be_paid)
        ? null
        : Math.round(result.to_be_paid);
    await manager.query(
      `UPDATE integration.parcel_request
          SET status='CREATED', shipment_id=$2, qr_code_token=$3,
              tracking_url=$4, to_be_paid=$5, last_error=NULL,
              attempts=attempts+1, updated_at=now()
        WHERE id=$1`,
      [
        row.id,
        String(result.shipment_id),
        result.qr_code_token ?? null,
        result.tracking_url ?? null,
        toBePaid,
      ],
    );
    await this.outbox.record(
      {
        aggregateType: 'order',
        aggregateId: String(row.orderId),
        eventType: ORDER_EVENTS.PARCEL_CREATED,
        payload: {
          eventId: `${ORDER_EVENTS.PARCEL_CREATED}:${row.orderId}`,
          orderId: String(row.orderId),
          shipmentId: String(result.shipment_id),
          qrCodeToken: result.qr_code_token ?? null,
          trackingUrl: result.tracking_url ?? null,
          toBePaid,
          createdAt: new Date().toISOString(),
        } satisfies ElchiParcelCreatedEvent,
      },
      manager,
    );
  }

  /**
   * Elchi da bekor qilish. `shipment_id` noma'lum bo'lsa (javob kelmagan
   * yaratish), Elchi posilkani `external_order_id` bo'yicha topadi; 404 —
   * posilka umuman yaratilmagan.
   */
  private async cancel(manager: EntityManager, row: ParcelRow): Promise<void> {
    const ref = row.shipmentId ?? elchiOrderRef(String(row.orderId));
    try {
      await this.elchi.cancelShipment(ref);
    } catch (error) {
      await this.cancelFailed(manager, row, error as Error);
      return;
    }
    await this.setStatus(manager, row.id, 'CANCELLED', null);
    await this.recordCancelResult(
      manager,
      row,
      ORDER_EVENTS.PARCEL_CANCELLED,
      null,
    );
  }

  private async cancelFailed(
    manager: EntityManager,
    row: ParcelRow,
    error: Error,
  ): Promise<void> {
    if (error instanceof ElchiApiError && error.status === 404) {
      if (!row.shipmentId && row.createRecent) {
        // Javobi kelmagan yaratish hali tugamagan bo'lishi mumkin.
        await this.retryLater(manager, row, error.message);
        return;
      }
      await this.setStatus(manager, row.id, 'CANCELLED', error.message);
      return;
    }
    if (
      error instanceof ElchiApiError &&
      (error.status === 409 || REJECT_STATUSES.has(error.status))
    ) {
      // 409 — Elchi yetkazilgan posilkani bekor qilmaydi: posilka o'z holida.
      this.logger.warn(
        `Buyurtma ${row.orderId}: Elchi posilkani bekor qilmadi (${error.status})`,
      );
      await this.setStatus(manager, row.id, 'CREATED', error.message);
      await this.recordCancelResult(
        manager,
        row,
        ORDER_EVENTS.PARCEL_CANCEL_FAILED,
        error.message,
      );
      return;
    }
    await this.retryLater(manager, row, error.message);
  }

  /** SOATO → Elchi viloyat/tuman ID si (geo kesh, C1.44; EQ-06 2026-11-16). */
  private async resolveGeo(
    manager: EntityManager,
    event: OrderStatusChangedEvent,
  ): Promise<{ regionId: string; districtId: string } | null> {
    const rows = (await manager.query(
      `SELECT kind, elchi_id::text AS "elchiId",
              elchi_region_id::text AS "elchiRegionId"
         FROM integration.geo_cache
        WHERE is_deleted = false
          AND ((kind='region' AND sato_code=$1)
            OR (kind='district' AND sato_code=$2))`,
      [event.recipient.regionSoato, event.recipient.districtSoato],
    )) as Array<{
      kind: 'region' | 'district';
      elchiId: string;
      elchiRegionId: string | null;
    }>;
    const district = rows.find((row) => row.kind === 'district');
    const region = rows.find((row) => row.kind === 'region');
    if (!district) return null;
    // Tuman boshqa viloyatga tegishli bo'lsa — manzil noto'g'ri.
    if (
      region &&
      district.elchiRegionId &&
      district.elchiRegionId !== region.elchiId
    ) {
      return null;
    }
    const regionId = region?.elchiId ?? district.elchiRegionId;
    if (!regionId) return null;
    return { regionId, districtId: district.elchiId };
  }

  /**
   * Tuman topilmasa geo kesh yangilanadi (kesh bo'sh yoki eski bo'lishi
   * mumkin — masalan, yangi o'rnatishdan keyin); bir daqiqada ko'pi bilan bir
   * marta. Natija:
   *  - 'fresh' — hozir yangilandi, qayta qidirish kerak;
   *  - 'recent' — yaqinda muvaffaqiyatli yangilangan, kesh ishonchli;
   *  - 'unavailable' — yangilab bo'lmadi, tuman yo'qligiga ishonib bo'lmaydi.
   */
  private async refreshGeoCache(): Promise<'fresh' | 'recent' | 'unavailable'> {
    const now = Date.now();
    if (now - this.lastGeoSyncAttemptAt < GEO_SYNC_INTERVAL_MS) {
      return this.lastGeoSyncOkAt >= this.lastGeoSyncAttemptAt
        ? 'recent'
        : 'unavailable';
    }
    this.lastGeoSyncAttemptAt = now;
    try {
      await this.geo.syncGeoCache();
      this.lastGeoSyncOkAt = Date.now();
      return 'fresh';
    } catch (error) {
      this.logger.warn(`Geo kesh yangilanmadi: ${(error as Error).message}`);
      return 'unavailable';
    }
  }

  /** «Tasdiqlandi» hodisasi posilka uchun yetarlimi; yetmasa sababi. */
  private invalidReason(event: OrderStatusChangedEvent): string | null {
    const r = event.recipient;
    if (
      !r?.name ||
      !r?.phone ||
      !r?.regionSoato ||
      !r?.districtSoato ||
      !r?.addressLine
    ) {
      return 'qabul qiluvchi ma’lumoti to‘liq emas';
    }
    if (!Array.isArray(event.items) || !event.items.length) {
      return 'tovarlar ro‘yxati bo‘sh';
    }
    for (const item of event.items) {
      if (!item?.productId || !item?.name) return 'tovar nomi yoki ID si yo‘q';
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
        return `tovar soni noto‘g‘ri: ${item.quantity}`;
      }
      if (
        item.weightGrams !== null &&
        item.weightGrams !== undefined &&
        (!Number.isSafeInteger(item.weightGrams) ||
          item.weightGrams < 1 ||
          item.weightGrams > MAX_WEIGHT_GRAMS)
      ) {
        return `tovar og‘irligi noto‘g‘ri: ${item.weightGrams} g`;
      }
    }
    if (!Number.isSafeInteger(event.codAmount) || event.codAmount < 0) {
      return `COD summasi noto‘g‘ri: ${event.codAmount}`;
    }
    return null;
  }

  /**
   * Keyinroq qayta urinish. `now()` emas, `clock_timestamp()`: `now()`
   * tranzaksiya boshlangan vaqt — 70 s lik Elchi chaqiruvidan keyin
   * `now() + 30 s` allaqachon o'tib ketgan bo'lardi.
   */
  private async retryLater(
    manager: EntityManager,
    row: ParcelRow,
    message: string,
    retryAt?: string | null,
  ): Promise<void> {
    const delay =
      RETRY_DELAYS_S[Math.min(row.attempts, RETRY_DELAYS_S.length - 1)];
    const at = retryAt && !Number.isNaN(Date.parse(retryAt)) ? retryAt : null;
    this.logger.warn(
      `Buyurtma ${row.orderId}: Elchi so‘rovi o‘tmadi (${row.attempts + 1}-urinish), ${at ?? `${delay} s dan keyin`} qayta: ${message}`,
    );
    await manager.query(
      `UPDATE integration.parcel_request
          SET attempts=attempts+1,
              next_attempt_at=GREATEST(
                clock_timestamp() + make_interval(secs => $2),
                COALESCE($4::timestamptz, '-infinity'::timestamptz)),
              last_error=$3, updated_at=now()
        WHERE id=$1`,
      [row.id, delay, message, at],
    );
  }

  /** Tranzaksiya xato bilan tugagan qator: alohida tranzaksiyada keyinga suriladi. */
  private async bumpAfterCrash(row: ParcelRow, error: Error): Promise<void> {
    this.logger.error(
      `Buyurtma ${row.orderId}: posilka qatorini ishlashda xato: ${error.message}`,
    );
    await this.dataSource.query(
      `UPDATE integration.parcel_request
          SET attempts = attempts + 1,
              next_attempt_at = clock_timestamp() + make_interval(
                secs => (ARRAY[30,60,120,240,300])[LEAST(attempts, 4) + 1]),
              last_create_at = CASE WHEN status = 'PENDING' THEN clock_timestamp()
                                    ELSE last_create_at END,
              last_error = $2, updated_at = now()
        WHERE id = $1`,
      [row.id, error.message],
    );
  }

  private async fail(
    manager: EntityManager,
    row: ParcelRow,
    reason: ElchiParcelFailedEvent['reason'],
    message: string,
  ): Promise<void> {
    await this.setStatus(manager, row.id, 'FAILED', message);
    await this.recordFailed(manager, String(row.orderId), row.payload.eventId, {
      reason,
      message,
    });
  }

  private async recordFailed(
    manager: EntityManager,
    orderId: string,
    /**
     * Qatorni shu holatga olib kelgan «Tasdiqlandi» hodisasi: FAILED qator
     * faqat yangi tasdiq bilan qayta navbatga tushadi, shuning uchun id har
     * xatoda yangi (urinish soni esa qayta navbatda 0 ga qaytadi).
     */
    sourceEventId: string,
    failure: Pick<ElchiParcelFailedEvent, 'reason' | 'message'>,
  ): Promise<void> {
    await this.outbox.record(
      {
        aggregateType: 'order',
        aggregateId: orderId,
        eventType: ORDER_EVENTS.PARCEL_FAILED,
        payload: {
          eventId: `${ORDER_EVENTS.PARCEL_FAILED}:${orderId}:${sourceEventId}`,
          orderId,
          ...failure,
          at: new Date().toISOString(),
        } satisfies ElchiParcelFailedEvent,
      },
      manager,
    );
  }

  private async recordCancelResult(
    manager: EntityManager,
    row: ParcelRow,
    eventType:
      | typeof ORDER_EVENTS.PARCEL_CANCELLED
      | typeof ORDER_EVENTS.PARCEL_CANCEL_FAILED,
    message: string | null,
  ): Promise<void> {
    await this.outbox.record(
      {
        aggregateType: 'order',
        aggregateId: String(row.orderId),
        eventType,
        payload: {
          eventId: `${eventType}:${row.orderId}:${row.attempts + 1}`,
          orderId: String(row.orderId),
          shipmentId: row.shipmentId,
          message,
          at: new Date().toISOString(),
        } satisfies ElchiParcelCancelResultEvent,
      },
      manager,
    );
  }

  private async setStatus(
    manager: EntityManager,
    id: string,
    status: ParcelStatus,
    lastError: string | null,
  ): Promise<void> {
    await manager.query(
      `UPDATE integration.parcel_request
          SET status=$2, last_error=$3, attempts=attempts+1, updated_at=now()
        WHERE id=$1`,
      [id, status, lastError],
    );
  }
}
