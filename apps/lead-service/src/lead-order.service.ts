import { Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AffiliatePostbackEvent,
  LeadOrderStatus,
  OrderStatusChangedEvent,
  processOnce,
} from '@app/common';
import { CapiService } from './capi.service';
import { Lead } from './entities';
import { PostbackService } from './postback.service';
import { expectedAffiliateCommission } from './order-commission';

/** Yetkazilgan buyurtmaning keyingi holatlari: DELIVERED hodisasi kelmay qolsa ham yetkazilgan kun yoziladi. */
export const DELIVERED_LIKE = new Set<LeadOrderStatus>([
  LeadOrderStatus.DELIVERED,
  LeadOrderStatus.REMITTED,
  LeadOrderStatus.RETURN_REQUESTED,
  LeadOrderStatus.SETTLED,
]);
/** Mijoz posilkani olmadi va uning keyingi holatlari (TZ T5 holatlar mashinasi). */
const REFUSED_LIKE = new Set<LeadOrderStatus>([
  LeadOrderStatus.REFUSED,
  LeadOrderStatus.RETURNING,
  LeadOrderStatus.RETURNED_GRADED,
]);
const ID = /^\d{1,19}$/;
export const ORDER_STATUS_CONSUMER = 'lead.order-status';

/**
 * `order.status.changed` → lid (BE-28; TZ T02:56, T02:112 — lead-service shu hodisani qabul qiladi).
 * Lidga buyurtma ID si, oxirgi holati, yetkazildi/rad kuni va «Kutilmoqda» haqi yoziladi — sotuvchi statistikasi
 * va lidlar ro‘yxati shundan o‘qiladi. Hodisani checkout yuboradi (BE-18): relay uni LEAD navbatiga ham yuborishi kerak.
 * Takror hodisa (`eventId`) bir marta ishlanadi; eskirgan hodisa (`occurredAt` kichik) oxirgi holatni bosib ketmaydi.
 */
@Injectable()
export class LeadOrderService {
  private readonly logger = new Logger(LeadOrderService.name);

  constructor(
    private readonly db: DataSource,
    @Optional() private readonly capi?: CapiService,
    @Optional() private readonly postback?: PostbackService,
  ) {}

  async onOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    if (!event?.eventId || event.leadId === null || event.leadId === undefined)
      return; // asosiy sayt buyurtmasi — lid yo‘q
    const leadId = String(event.leadId);
    const at = new Date(event.occurredAt);
    if (
      !ID.test(leadId) ||
      !ID.test(String(event.orderId ?? '')) ||
      !Object.values(LeadOrderStatus).includes(event.status) ||
      Number.isNaN(at.getTime())
    ) {
      this.logger.warn(
        `order.status.changed ${event.eventId}: noto‘g‘ri hodisa (lead ${leadId}, order ${String(event.orderId)}, ${String(event.status)})`,
      );
      return;
    }
    await processOnce(
      this.db,
      {
        table: 'lead.processed_event',
        consumer: ORDER_STATUS_CONSUMER,
        eventId: event.eventId,
      },
      async (manager) => {
        const leads = manager.getRepository(Lead);
        const lead = await leads.findOne({
          where: { id: leadId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lead) {
          this.logger.warn(`order.status.changed: lid ${leadId} topilmadi`);
          return;
        }
        const orderId = String(event.orderId);
        if (lead.orderId && lead.orderId !== orderId) {
          this.logger.warn(
            `order.status.changed: lid ${leadId} boshqa buyurtmada (${lead.orderId}), ${orderId} e’tiborsiz`,
          );
          return;
        }
        lead.orderId = orderId;
        if (!lead.orderStatusAt || at >= lead.orderStatusAt) {
          lead.orderStatus = event.status;
          lead.orderStatusAt = at;
        }
        // Eng erta hodisa vaqti: tartibsiz kelsa ham (REMITTED DELIVERED dan oldin) kun ledger yozuvi kuni bilan bir xil
        if (
          DELIVERED_LIKE.has(event.status) &&
          (!lead.deliveredAt || at < lead.deliveredAt)
        )
          lead.deliveredAt = at;
        if (
          REFUSED_LIKE.has(event.status) &&
          (!lead.refusedAt || at < lead.refusedAt)
        )
          lead.refusedAt = at;
        const expected = expectedAffiliateCommission(event.items);
        if (expected !== null) lead.expectedCommission = String(expected);
        await leads.save(lead);
        // BE-31: Meta CAPI Purchase — birinchi yetkazilganda (lead_id + event unikal), summa — mijoz to‘lagan jami
        if (DELIVERED_LIKE.has(event.status) && lead.deliveredAt) {
          await this.capi?.enqueuePurchase(
            manager,
            lead,
            event.codAmount,
            lead.deliveredAt,
          );
          // BE-14 (SOT-5): «yetkazildi» postback — bir marta (lead_id + event unikal)
          await this.postback?.enqueue(
            manager,
            lead,
            AffiliatePostbackEvent.DELIVERED,
          );
        }
      },
    );
  }
}
