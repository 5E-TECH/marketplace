import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  ElchiParcelCancelResultEvent,
  ElchiParcelCreatedEvent,
  ElchiParcelFailedEvent,
  ParcelElchiState,
  processOnce,
} from '@app/common';

const ID = /^[1-9]\d{0,18}$/;
const CONSUMER = 'checkout.elchi-parcel';

/**
 * Elchi posilka xabarlari (BE-20 → BE-19): posilka yaratildi, yaratilmadi, bekor qilindi, bekor qilinmadi. Lid
 * buyurtmasining posilkasiga yoziladi — yorliqdagi Elchi raqami va QR (Elchi skaneri QR token bo‘yicha qidiradi)
 * shundan. Takror xabar bir marta ishlanadi (`checkout.processed_event`).
 *
 * Ishga tushirish: elchi-integration’da `ELCHI_OUTBOX_RELAY=on`.
 */
@Injectable()
export class ElchiParcelEventsService {
  private readonly logger = new Logger(ElchiParcelEventsService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onCreated(event: ElchiParcelCreatedEvent): Promise<void> {
    const shipmentId = String(event?.shipmentId ?? '');
    if (!ID.test(shipmentId)) {
      this.logger.error(
        `elchi.parcel.created: Elchi posilka raqami noto‘g‘ri (${shipmentId || '—'}, buyurtma ${String(event?.orderId)})`,
      );
      return;
    }
    const toBePaid =
      event.toBePaid != null && Number.isSafeInteger(Number(event.toBePaid))
        ? Number(event.toBePaid)
        : null;
    await this.handle(event, (manager, orderId) =>
      manager.query(
        `UPDATE checkout.parcel p
            SET elchi_shipment_id = $2, tracking_url = $3, qr_code_token = $4,
                elchi_to_be_paid = $5, elchi_error = NULL, updated_at = now(),
                -- kech kelgan «yaratildi» bekor qilingan posilkani qayta ochmaydi
                elchi_state = CASE WHEN p.elchi_state IN ('CANCELLED') THEN p.elchi_state ELSE 'CREATED' END
           FROM checkout.sales_order o
          WHERE o.id = p.sales_order_id AND o.source IS NOT NULL AND p.sales_order_id = $1
          RETURNING p.id`,
        [
          orderId,
          shipmentId,
          event.trackingUrl ?? null,
          event.qrCodeToken ?? null,
          toBePaid,
        ],
      ),
    );
  }

  async onFailed(event: ElchiParcelFailedEvent): Promise<void> {
    await this.setState(
      event,
      ParcelElchiState.FAILED,
      `${String(event?.reason ?? '')}: ${String(event?.message ?? '')}`,
    );
  }

  async onCancelled(event: ElchiParcelCancelResultEvent): Promise<void> {
    await this.setState(event, ParcelElchiState.CANCELLED, null);
  }

  async onCancelFailed(event: ElchiParcelCancelResultEvent): Promise<void> {
    await this.setState(
      event,
      ParcelElchiState.CANCEL_FAILED,
      String(event?.message ?? 'Elchi bekor qilmadi'),
    );
  }

  private setState(
    event: { eventId: string; orderId: string },
    state: ParcelElchiState,
    error: string | null,
  ): Promise<void> {
    return this.handle(event, (manager, orderId) =>
      manager.query(
        `UPDATE checkout.parcel p
            SET elchi_state = $2, elchi_error = $3, updated_at = now()
           FROM checkout.sales_order o
          WHERE o.id = p.sales_order_id AND o.source IS NOT NULL AND p.sales_order_id = $1
          RETURNING p.id`,
        [orderId, state, error ? error.slice(0, 2000) : null],
      ),
    );
  }

  private async handle(
    event: { eventId: string; orderId: string },
    update: (manager: EntityManager, orderId: string) => Promise<unknown>,
  ): Promise<void> {
    const orderId = String(event?.orderId ?? '');
    const eventId = String(event?.eventId ?? '');
    if (!ID.test(orderId) || !eventId || eventId.length > 200) {
      this.logger.error(
        `Elchi posilka xabari rad etildi: buyurtma yoki xabar ID si noto‘g‘ri (${orderId || '—'})`,
      );
      return;
    }
    await processOnce(
      this.dataSource,
      { table: 'checkout.processed_event', consumer: CONSUMER, eventId },
      async (manager) => {
        const result = (await update(manager, orderId)) as unknown[];
        const rows =
          result.length === 2 && Array.isArray(result[0]) ? result[0] : result;
        if (!(rows as unknown[]).length)
          this.logger.warn(
            `Elchi posilka xabari: lid buyurtmasi ${orderId} topilmadi (xabar ${eventId})`,
          );
      },
    );
  }
}
