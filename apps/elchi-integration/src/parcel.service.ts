import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import {
  CheckoutDeliveryDestination,
  ElchiParcelCreatedEvent,
  ElchiParcelFailedEvent,
  LeadOrderStatus,
  ORDER_EVENTS,
  OrderStatusChangedEvent,
  OutboxService,
  processOnce,
  runAsLeader,
} from '@app/common';
import { ElchiApiClient, ElchiApiError } from './elchi-api.client';

export type ParcelStatus =
  'PENDING' | 'CREATED' | 'FAILED' | 'CANCEL_PENDING' | 'CANCELLED';

interface ParcelRow {
  id: string;
  orderId: string;
  status: ParcelStatus;
  payload: OrderStatusChangedEvent;
  shipmentId: string | null;
  attempts: number;
}

/**
 * Qayta urinish oralig'i, soniya [taklif]: 30 s, 1, 2, 4 daqiqa, keyin har
 * 5 daqiqa — cheksiz. Elchi ishlamasa buyurtma navbatda kutadi (BE-20 TC2).
 */
const RETRY_DELAYS_S = [30, 60, 120, 240, 300];

/** Qayta urinish foyda bermaydigan Elchi javoblari (so'rov xato). */
const REJECT_STATUSES = new Set([400, 401, 403, 404, 422]);

const CONSUMER = 'elchi-parcel';

/**
 * BE-20: Elchi posilkasi buyurtma tranzaksiyasidan tashqarida, navbat orqali.
 *
 * 1. `order.status.changed` («Tasdiqlandi») → `parcel_request` qatori
 *    (buyurtma bo'yicha bitta, takroriy hodisa ikkinchisini yaratmaydi).
 * 2. Ishchi (cron, yetakchi qulf bilan) navbatdagi qatorni oladi va Elchi
 *    platforma marketida posilka yaratadi; natija `elchi.parcel.created`
 *    bilan outbox orqali checkout ga qaytadi (BE-19 yozadi).
 * 3. «Bekor qilindi» → hali yaratilmagan bo'lsa navbatdan chiqadi, yaratilgan
 *    bo'lsa Elchi da bekor qilinadi (idempotent).
 *
 * Eski har-do'kon marketi yo'li (`integration.shipment.create`) BE-18 merge
 * qilinguncha o'zgarishsiz qoladi: hozirgi checkout hali uni chaqiradi.
 */
@Injectable()
export class ParcelService {
  private readonly logger = new Logger(ParcelService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly elchi: ElchiApiClient,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
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
          await this.enqueue(manager, event);
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
    let handled = 0;
    while (handled < limit) {
      const done = await this.dataSource.transaction(async (manager) => {
        const [row] = (await manager.query(
          `SELECT id::text, order_id AS "orderId", status, payload,
                  shipment_id AS "shipmentId", attempts
             FROM integration.parcel_request
            WHERE status IN ('PENDING','CANCEL_PENDING')
              AND next_attempt_at <= now()
            ORDER BY next_attempt_at, id
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
        )) as ParcelRow[];
        if (!row) return false;
        if (row.status === 'PENDING') await this.create(manager, row);
        else await this.cancel(manager, row);
        return true;
      });
      if (!done) break;
      handled++;
    }
    return handled;
  }

  private async enqueue(
    manager: EntityManager,
    event: OrderStatusChangedEvent,
  ): Promise<void> {
    this.assertRecipient(event);
    // order_id UNIQUE: «Tasdiqlandi» ikki marta kelsa ham bitta posilka (TC1).
    await manager.query(
      `INSERT INTO integration.parcel_request (order_id, payload)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (order_id) DO NOTHING`,
      [String(event.orderId), JSON.stringify(event)],
    );
  }

  /**
   * «Bekor qilindi»: navbatdagi/xato qator — darhol CANCELLED; yaratilgan
   * posilka — CANCEL_PENDING (ishchi Elchi da bekor qiladi). Qator bo'lmasa
   * CANCELLED belgisi qoladi: kechikkan «Tasdiqlandi» posilka yaratmaydi.
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
               WHEN parcel_request.status IN ('PENDING','FAILED') THEN 'CANCELLED'
               WHEN parcel_request.status = 'CREATED' THEN 'CANCEL_PENDING'
               ELSE parcel_request.status
             END,
             next_attempt_at = now(),
             updated_at = now()`,
      [String(event.orderId), JSON.stringify(event)],
    );
  }

  private async create(manager: EntityManager, row: ParcelRow): Promise<void> {
    const event = row.payload;
    const geo = await this.resolveGeo(manager, event);
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
    try {
      const result = await this.elchi.createShipment({
        external_order_id: String(row.orderId),
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
      await manager.query(
        `UPDATE integration.parcel_request
            SET status='CREATED', shipment_id=$2, qr_code_token=$3,
                tracking_url=$4, to_be_paid=$5, last_error=NULL,
                attempts=attempts+1, updated_at=now()
          WHERE id=$1`,
        [
          row.id,
          result.shipment_id,
          result.qr_code_token ?? null,
          result.tracking_url ?? null,
          result.to_be_paid ?? null,
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
            shipmentId: result.shipment_id,
            qrCodeToken: result.qr_code_token ?? null,
            trackingUrl: result.tracking_url ?? null,
            toBePaid: result.to_be_paid ?? null,
            createdAt: new Date().toISOString(),
          } satisfies ElchiParcelCreatedEvent,
        },
        manager,
      );
    } catch (error) {
      if (error instanceof ElchiApiError && REJECT_STATUSES.has(error.status)) {
        this.logger.warn(`Buyurtma ${row.orderId}: ${error.message}`);
        await this.fail(manager, row, 'ELCHI_REJECTED', error.message);
        return;
      }
      await this.retryLater(manager, row, (error as Error).message);
    }
  }

  private async cancel(manager: EntityManager, row: ParcelRow): Promise<void> {
    if (!row.shipmentId) {
      await this.setStatus(manager, row.id, 'CANCELLED', null);
      return;
    }
    try {
      await this.elchi.cancelShipment(row.shipmentId);
      await this.setStatus(manager, row.id, 'CANCELLED', null);
    } catch (error) {
      if (error instanceof ElchiApiError && error.status === 409) {
        // Elchi yetkazilgan posilkani bekor qilmaydi — posilka o'z holida.
        this.logger.warn(
          `Buyurtma ${row.orderId}: Elchi posilkani bekor qilmadi (409)`,
        );
        await this.setStatus(manager, row.id, 'CREATED', error.message);
        return;
      }
      if (error instanceof ElchiApiError && error.status === 404) {
        await this.setStatus(manager, row.id, 'CANCELLED', error.message);
        return;
      }
      await this.retryLater(manager, row, (error as Error).message);
    }
  }

  /** SOATO → Elchi viloyat/tuman ID si (geo kesh, C1.44; EQ-06 2026-11-16). */
  private async resolveGeo(
    manager: EntityManager,
    event: OrderStatusChangedEvent,
  ): Promise<{ regionId: string; districtId: string } | null> {
    const rows = (await manager.query(
      `SELECT kind, elchi_id::text AS "elchiId",
              elchi_region_id::text AS "elchiRegionId", sato_code AS "satoCode"
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

  private assertRecipient(event: OrderStatusChangedEvent): void {
    const r = event.recipient;
    if (
      !r?.name ||
      !r?.phone ||
      !r?.regionSoato ||
      !r?.districtSoato ||
      !r?.addressLine ||
      !Array.isArray(event.items) ||
      !event.items.length ||
      !Number.isSafeInteger(event.codAmount) ||
      event.codAmount < 0
    ) {
      throw new BadRequestException(
        `order.status.changed ${event.orderId}: qabul qiluvchi, tovar yoki summa to‘liq emas`,
      );
    }
  }

  private async retryLater(
    manager: EntityManager,
    row: ParcelRow,
    message: string,
  ): Promise<void> {
    const delay =
      RETRY_DELAYS_S[Math.min(row.attempts, RETRY_DELAYS_S.length - 1)];
    this.logger.warn(
      `Buyurtma ${row.orderId}: Elchi so‘rovi o‘tmadi (${row.attempts + 1}-urinish), ${delay} s dan keyin qayta: ${message}`,
    );
    await manager.query(
      `UPDATE integration.parcel_request
          SET attempts=attempts+1,
              next_attempt_at=now() + make_interval(secs => $2),
              last_error=$3, updated_at=now()
        WHERE id=$1`,
      [row.id, delay, message],
    );
  }

  private async fail(
    manager: EntityManager,
    row: ParcelRow,
    reason: ElchiParcelFailedEvent['reason'],
    message: string,
  ): Promise<void> {
    await this.setStatus(manager, row.id, 'FAILED', message);
    await this.outbox.record(
      {
        aggregateType: 'order',
        aggregateId: String(row.orderId),
        eventType: ORDER_EVENTS.PARCEL_FAILED,
        payload: {
          eventId: `${ORDER_EVENTS.PARCEL_FAILED}:${row.orderId}:${row.attempts + 1}`,
          orderId: String(row.orderId),
          reason,
          message,
          at: new Date().toISOString(),
        } satisfies ElchiParcelFailedEvent,
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
