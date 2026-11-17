import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import {
  CheckoutDeliveryDestination,
  ElchiParcelCancelResultEvent,
  ElchiParcelCreatedEvent,
  ElchiParcelFailedEvent,
  ElchiShipmentResult,
  LeadOrderStatus,
  ORDER_EVENTS,
  OrderStatusChangedEvent,
  OutboxService,
  elchiOrderRef,
  processOnce,
  queryRows,
  runAsLeader,
} from '@app/common';
import {
  CreateElchiShipmentInput,
  ElchiApiClient,
  ElchiApiError,
} from './elchi-api.client';
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
  /** Yaratish so'rovi Elchi ga yuborilganmi (`last_create_at` bor). */
  sent: boolean;
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

/** Bitta ishchi urishining vaqt chegarasi [taklif]. */
const TICK_BUDGET_MS = 60_000;

/**
 * Olingan qator shu vaqt band turadi [taklif]: Elchi yaratish kutishi 70 s va
 * QR so'rovi 15 s dan uzun. Jarayon o'lsa, qator lease tugagach qayta olinadi.
 */
const CLAIM_LEASE_S = 120;

/** Geo kesh tuman topilmaganda bir daqiqada ko'pi bilan bir marta yangilanadi [taklif]. */
const GEO_SYNC_INTERVAL_MS = 60_000;

const CONSUMER = 'elchi-parcel';

/**
 * Elchi `order_items.product_name` VARCHAR(255): undan uzun nom Elchi da
 * buyurtmani yaratmaydi va takror kaliti abadiy «xato» bo'lib qoladi
 * (Elchi-Backend order-service). Nom ID qo'shimchasi bilan 255 ga sig'adi.
 */
const ELCHI_ITEM_NAME_MAX = 255;

export function elchiItemName(name: string, productId: string): string {
  const suffix = ` #${productId}`;
  return `${name.trim().slice(0, ELCHI_ITEM_NAME_MAX - suffix.length)}${suffix}`;
}

type BuildResult =
  | { body: CreateElchiShipmentInput }
  | { retry: string }
  | { fail: Pick<ElchiParcelFailedEvent, 'reason' | 'message'> };

/**
 * BE-20: Elchi posilkasi buyurtma tranzaksiyasidan tashqarida, navbat orqali.
 *
 * 1. `order.status.changed` («Tasdiqlandi») → `parcel_request` qatori
 *    (buyurtma bo'yicha bitta, takroriy hodisa ikkinchisini yaratmaydi).
 * 2. Ishchi (cron, yetakchi qulf bilan) navbatdagi qatorni qisqa
 *    tranzaksiyada oladi (lease), «yuborildi» belgisini Elchi ga yuborishdan
 *    OLDIN commit qiladi, Elchi ni tranzaksiyadan tashqarida chaqiradi va
 *    natijani holatni tekshirib yozadi. Natija `elchi.parcel.created` bilan
 *    outbox orqali checkout ga qaytadi (BE-19 yozadi).
 * 3. «Bekor qilindi» → Elchi ga yuborilmagan bo'lsa navbatdan chiqadi;
 *    yuborilgan bo'lsa Elchi da bekor qilinadi (idempotent). Elchi bekor
 *    qilishda posilkani faqat o'z bog'lovchi yozuvi orqali topadi; yozuv
 *    yo'q bo'lsa (yaratish javobi yo'qolgan) 404 beradi — shunda takroriy
 *    (idempotent) yaratish posilka ID sini qaytaradi va u bekor qilinadi.
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
      const row = await this.claimNext();
      if (!row) break;
      try {
        if (row.status === 'PENDING') await this.create(row);
        else await this.cancel(row);
      } catch (error) {
        // Kutilmagan xato (baza, ma'lumot): qator navbat boshini to'sib
        // qo'ymasin — urinish yoziladi va keyinga suriladi.
        await this.bumpAfterCrash(row, error as Error);
      }
      handled++;
    }
    return handled;
  }

  /** Qisqa tranzaksiya: vaqti kelgan qatorni oladi va lease bilan band qiladi. */
  private claimNext(): Promise<ParcelRow | undefined> {
    return this.dataSource.transaction(async (manager) => {
      const [row] = (await manager.query(
        `SELECT id::text, order_id AS "orderId", status, payload,
                shipment_id AS "shipmentId", attempts,
                last_create_at IS NOT NULL AS "sent"
           FROM integration.parcel_request
          WHERE status IN ('PENDING','CANCEL_PENDING')
            AND next_attempt_at <= now()
          ORDER BY next_attempt_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
      )) as ParcelRow[];
      if (!row) return undefined;
      await manager.query(
        `UPDATE integration.parcel_request
            SET next_attempt_at = clock_timestamp() + make_interval(secs => $2)
          WHERE id = $1`,
        [row.id, CLAIM_LEASE_S],
      );
      return row;
    });
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
   *  - Elchi ga yaratish so'rovi yuborilmagan (PENDING yoki FAILED,
   *    `last_create_at` yo'q) → CANCELLED. Belgi Elchi ga yuborishdan oldin
   *    alohida commit qilinadi, shuning uchun bunga ishonsa bo'ladi;
   *  - qolgani (CREATED, yuborilgan PENDING/FAILED) → CANCEL_PENDING: ishchi
   *    Elchi da bekor qiladi. Yaratish shu payt ketayotgan bo'lsa, natija
   *    yozilganda CANCEL_PENDING ko'riladi va posilka bekor qilinadi.
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
               WHEN parcel_request.status IN ('PENDING','FAILED')
                    AND parcel_request.last_create_at IS NULL THEN 'CANCELLED'
               WHEN parcel_request.status IN ('PENDING','CREATED','FAILED')
                    THEN 'CANCEL_PENDING'
               ELSE parcel_request.status
             END,
             next_attempt_at = now(),
             updated_at = now()`,
      [String(event.orderId), JSON.stringify(event)],
    );
  }

  private async create(row: ParcelRow): Promise<void> {
    const built = await this.buildShipment(row);
    if ('retry' in built) {
      await this.retryLater(row, built.retry);
      return;
    }
    if ('fail' in built) {
      this.logger.warn(`Buyurtma ${row.orderId}: ${built.fail.message}`);
      await this.fail(row, built.fail.reason, built.fail.message);
      return;
    }
    // «Yuborildi» belgisi Elchi chaqiruvidan OLDIN commit qilinadi. Qator shu
    // orada bekor qilingan bo'lsa (PENDING emas) — so'rov yuborilmaydi.
    const marked = queryRows(
      await this.dataSource.query(
        `UPDATE integration.parcel_request SET last_create_at = clock_timestamp()
        WHERE id = $1 AND status = 'PENDING'
        RETURNING id`,
        [row.id],
      ),
    ) as unknown[];
    if (!marked.length) return;

    let result: ElchiShipmentResult;
    try {
      result = await this.elchi.createShipment(built.body);
    } catch (error) {
      await this.createFailed(row, error as Error);
      return;
    }
    await this.finishCreate(row, result);
  }

  private async createFailed(row: ParcelRow, error: Error): Promise<void> {
    if (
      error instanceof ElchiApiError &&
      error.status === 409 &&
      error.code === 'ORDER_INTAKE_CLOSED'
    ) {
      // Bugungi qabul yopiq: Elchi kalitni band qilmaydi, `reopens_at` dan
      // keyin o'sha external_order_id ishlaydi (Elchi-Backend
      // integration-service `requestPartnerOrderCreate`).
      await this.retryLater(row, error.message, error.reopensAt);
      if (!row.sent) {
        // Birinchi so'rov edi va Elchi hech narsa yaratmadi — «yuborildi»
        // belgisi olib tashlanadi: tunda bekor qilinsa Elchi ga murojaat yo'q.
        await this.dataSource.query(
          `UPDATE integration.parcel_request SET last_create_at = NULL
            WHERE id = $1 AND status = 'PENDING'`,
          [row.id],
        );
      }
      return;
    }
    if (
      error instanceof ElchiApiError &&
      (REJECT_STATUSES.has(error.status) || error.status === 409)
    ) {
      this.logger.warn(`Buyurtma ${row.orderId}: ${error.message}`);
      await this.fail(row, 'ELCHI_REJECTED', error.message);
      return;
    }
    await this.retryLater(row, error.message);
  }

  /**
   * Elchi natijasini qatorning HOZIRGI holati bo'yicha yozadi:
   *  - PENDING → CREATED va `elchi.parcel.created` (QR kodi bo'lsa; bo'lmasa
   *    posilka ID si yoziladi va qayta so'raladi — yorliqqa QR kerak);
   *  - CANCEL_PENDING (yaratish paytida «Bekor qilindi» keldi) → posilka ID si
   *    yoziladi, hodisa yo'q, darhol bekor qilish navbatiga.
   */
  private async finishCreate(
    row: ParcelRow,
    result: ElchiShipmentResult,
  ): Promise<void> {
    const toBePaid =
      result.to_be_paid === undefined || !Number.isFinite(result.to_be_paid)
        ? null
        : Math.round(result.to_be_paid);
    const fields = [
      row.id,
      String(result.shipment_id),
      result.qr_code_token ?? null,
      result.tracking_url ?? null,
      toBePaid,
    ];
    await this.dataSource.transaction(async (manager) => {
      const [current] = (await manager.query(
        `SELECT status FROM integration.parcel_request WHERE id = $1 FOR UPDATE`,
        [row.id],
      )) as Array<{ status: ParcelStatus }>;
      if (current?.status === 'CANCEL_PENDING') {
        await manager.query(
          `UPDATE integration.parcel_request
              SET shipment_id=$2, qr_code_token=$3, tracking_url=$4,
                  to_be_paid=$5, next_attempt_at=now(), updated_at=now()
            WHERE id=$1`,
          fields,
        );
        return;
      }
      if (current?.status !== 'PENDING') {
        this.logger.warn(
          `Buyurtma ${row.orderId}: posilka ${result.shipment_id} yaratildi, lekin qator ${current?.status ?? 'yo‘q'}`,
        );
        return;
      }
      if (!result.qr_code_token) {
        await manager.query(
          `UPDATE integration.parcel_request
              SET shipment_id=$2, tracking_url=$3, to_be_paid=$4,
                  attempts=attempts+1,
                  next_attempt_at=clock_timestamp() + make_interval(secs => $5),
                  last_error='Elchi javobida QR kodi yo‘q', updated_at=now()
            WHERE id=$1`,
          [
            row.id,
            String(result.shipment_id),
            result.tracking_url ?? null,
            toBePaid,
            this.delayFor(row),
          ],
        );
        return;
      }
      await manager.query(
        `UPDATE integration.parcel_request
            SET status='CREATED', shipment_id=$2, qr_code_token=$3,
                tracking_url=$4, to_be_paid=$5, last_error=NULL,
                attempts=attempts+1, updated_at=now()
          WHERE id=$1`,
        fields,
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
            qrCodeToken: result.qr_code_token,
            trackingUrl: result.tracking_url ?? null,
            toBePaid,
            createdAt: new Date().toISOString(),
          } satisfies ElchiParcelCreatedEvent,
        },
        manager,
      );
    });
  }

  /** Elchi so'rovi tanasi: SOATO → Elchi ID, platforma marketi, tovarlar. */
  private async buildShipment(row: ParcelRow): Promise<BuildResult> {
    const event = row.payload;
    const manager = this.dataSource.manager;
    let geo = await this.resolveGeo(manager, event);
    if (!geo) {
      const sync = await this.refreshGeoCache();
      if (sync === 'fresh') geo = await this.resolveGeo(manager, event);
      // Kesh yangilanmadi — tuman yo'qligiga ishonib bo'lmaydi.
      if (!geo && sync === 'unavailable')
        return { retry: 'Geo kesh yangilanmadi' };
    }
    if (!geo) {
      return {
        fail: {
          reason: 'DISTRICT_NOT_FOUND',
          message: `Tuman topilmadi: SOATO ${event.recipient.districtSoato} (viloyat ${event.recipient.regionSoato})`,
        },
      };
    }
    const marketId = this.config.get<string>('ELCHI_PLATFORM_MARKET_ID');
    // Sozlama yo'q — posilka navbatda kutadi va logga tushadi.
    if (!marketId) return { retry: 'ELCHI_PLATFORM_MARKET_ID sozlanmagan' };
    return {
      body: {
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
          // Elchi yangi tovarni market ichida NOMI bo'yicha bog'laydi va bir
          // marketda bir xil nomli ikki tovar bo'lmaydi (Elchi-Backend
          // `resolveCatalogProductId`). Hamma posilka bitta platforma
          // marketida — ikki sotuvchining bir xil nomli tovari bitta katalog
          // tovariga bog'lanib, og'irlik adashardi. ID bilan nom noyob [taklif].
          name: elchiItemName(item.name, String(item.productId)),
          quantity: item.quantity,
          external_product_id: String(item.productId),
          ...(item.weightGrams ? { weight_kg: item.weightGrams / 1000 } : {}),
        })),
        cod_amount: event.codAmount,
      },
    };
  }

  /** Elchi da bekor qilish: posilka ID si bo'yicha, bo'lmasa tashqi id bo'yicha. */
  private async cancel(row: ParcelRow): Promise<void> {
    if (!row.shipmentId && !row.sent) {
      await this.finishCancel(row, 'CANCELLED', null, null);
      return;
    }
    const ref = row.shipmentId ?? elchiOrderRef(String(row.orderId));
    try {
      await this.elchi.cancelShipment(ref);
    } catch (error) {
      await this.cancelFailed(row, error as Error);
      return;
    }
    await this.finishCancel(
      row,
      'CANCELLED',
      ORDER_EVENTS.PARCEL_CANCELLED,
      null,
    );
  }

  private async cancelFailed(row: ParcelRow, error: Error): Promise<void> {
    if (error instanceof ElchiApiError && error.status === 404) {
      if (!row.shipmentId) {
        // Elchi buyurtmani faqat bog'lovchi yozuv orqali topadi; yaratish
        // javobi yo'qolgan bo'lsa yozuv yo'q-u buyurtma bor bo'lishi mumkin.
        await this.recoverShipment(row);
        return;
      }
      await this.finishCancel(row, 'CANCELLED', null, error.message);
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
      await this.finishCancel(
        row,
        'CREATED',
        ORDER_EVENTS.PARCEL_CANCEL_FAILED,
        error.message,
      );
      return;
    }
    await this.retryLater(row, error.message);
  }

  /**
   * Bekor qilinadigan, lekin posilka ID si noma'lum qator: takroriy
   * (idempotent) yaratish Elchi dagi buyurtmani qaytaradi va bog'lovchi
   * yozuvni tiklaydi; ID yoziladi va keyingi urishda bekor qilinadi. Elchi
   * so'rovni rad etsa (400/422) — buyurtma umuman yo'q. Asl so'rov Elchi ga
   * yetmagan bo'lsa, yangi buyurtma yaratilib darhol bekor qilinadi.
   */
  private async recoverShipment(row: ParcelRow): Promise<void> {
    const built = await this.buildShipment(row);
    if ('retry' in built) {
      await this.retryLater(row, built.retry);
      return;
    }
    if ('fail' in built) {
      // So'rovni hozir tuzib bo'lmaydi va Elchi da bog'lovchi yozuv yo'q
      // (404) — bekor qilinadigan narsa yo'q.
      await this.finishCancel(row, 'CANCELLED', null, built.fail.message);
      return;
    }
    let result: ElchiShipmentResult;
    try {
      result = await this.elchi.createShipment(built.body);
    } catch (error) {
      if (
        error instanceof ElchiApiError &&
        error.status === 409 &&
        error.code === 'ORDER_INTAKE_CLOSED'
      ) {
        // Elchi qabul yopiq bo'lsa ham bog'lovchisiz buyurtma bo'lishi
        // mumkin — ochilgach qayta (5 daqiqada emas, reopens_at da).
        await this.retryLater(row, error.message, error.reopensAt);
        return;
      }
      if (
        error instanceof ElchiApiError &&
        (REJECT_STATUSES.has(error.status) || error.status === 409)
      ) {
        // Elchi so'rovni rad etdi: buyurtma umuman yaratilmagan.
        await this.finishCancel(row, 'CANCELLED', null, error.message);
        return;
      }
      await this.retryLater(row, (error as Error).message);
      return;
    }
    await this.finishCreate(row, result);
  }

  /** Bekor qilish natijasi — faqat qator hali CANCEL_PENDING bo'lsa. */
  private async finishCancel(
    row: ParcelRow,
    status: 'CANCELLED' | 'CREATED',
    eventType:
      | typeof ORDER_EVENTS.PARCEL_CANCELLED
      | typeof ORDER_EVENTS.PARCEL_CANCEL_FAILED
      | null,
    message: string | null,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const updated = queryRows(
        await manager.query(
          `UPDATE integration.parcel_request
            SET status=$2, last_error=$3, attempts=attempts+1, updated_at=now()
          WHERE id=$1 AND status='CANCEL_PENDING'
          RETURNING id`,
          [row.id, status, message],
        ),
      ) as unknown[];
      if (updated.length && eventType) {
        await this.recordCancelResult(manager, row, eventType, message);
      }
    });
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

  private delayFor(row: ParcelRow): number {
    return RETRY_DELAYS_S[Math.min(row.attempts, RETRY_DELAYS_S.length - 1)];
  }

  /**
   * Keyinroq qayta urinish — faqat qator hali olingan holatida bo'lsa (shu
   * orada «Bekor qilindi» kelgan bo'lsa, uning navbati buzilmaydi).
   * `clock_timestamp()`: `now()` tranzaksiya boshi emas, hozirgi vaqt.
   */
  private async retryLater(
    row: ParcelRow,
    message: string,
    retryAt?: string | null,
  ): Promise<void> {
    const delay = this.delayFor(row);
    const at = retryAt && !Number.isNaN(Date.parse(retryAt)) ? retryAt : null;
    this.logger.warn(
      `Buyurtma ${row.orderId}: Elchi so‘rovi o‘tmadi (${row.attempts + 1}-urinish), ${at ?? `${delay} s dan keyin`} qayta: ${message}`,
    );
    await this.dataSource.query(
      `UPDATE integration.parcel_request
          SET attempts=attempts+1,
              next_attempt_at=GREATEST(
                clock_timestamp() + make_interval(secs => $2),
                COALESCE($4::timestamptz, '-infinity'::timestamptz)),
              last_error=$3, updated_at=now()
        WHERE id=$1 AND status=$5`,
      [row.id, delay, message, at, row.status],
    );
  }

  /** Kutilmagan xato: qator keyinga suriladi (lease dan keyin emas, backoff bilan). */
  private async bumpAfterCrash(row: ParcelRow, error: Error): Promise<void> {
    this.logger.error(
      `Buyurtma ${row.orderId}: posilka qatorini ishlashda xato: ${error.message}`,
    );
    await this.dataSource.query(
      `UPDATE integration.parcel_request
          SET attempts = attempts + 1,
              next_attempt_at = clock_timestamp() + make_interval(
                secs => (ARRAY[30,60,120,240,300])[LEAST(attempts, 4) + 1]),
              last_error = $2, updated_at = now()
        WHERE id = $1 AND status IN ('PENDING','CANCEL_PENDING')`,
      [row.id, error.message],
    );
  }

  /** Qaytarilmas xato: FAILED va `elchi.parcel.failed` — qator hali PENDING bo'lsa. */
  private async fail(
    row: ParcelRow,
    reason: ElchiParcelFailedEvent['reason'],
    message: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const updated = queryRows(
        await manager.query(
          `UPDATE integration.parcel_request
            SET status='FAILED', last_error=$2, attempts=attempts+1, updated_at=now()
          WHERE id=$1 AND status='PENDING'
          RETURNING id`,
          [row.id, message],
        ),
      ) as unknown[];
      if (!updated.length) return;
      await this.recordFailed(
        manager,
        String(row.orderId),
        row.payload.eventId,
        { reason, message },
      );
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
}
