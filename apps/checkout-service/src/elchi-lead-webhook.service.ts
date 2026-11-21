import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  ElchiWebhookDto,
  FinanceRemittanceEvent,
  LEAD_ORDER_CANCELLABLE,
  LEAD_ORDER_TRANSITIONS,
  LeadOrderActor,
  LeadOrderActorType,
  LeadOrderStatus,
  leadOrderIdFromElchiRef,
  OutboxService,
} from '@app/common';
import {
  InventoryCommand,
  LeadOrderStatusService,
  TransitionRejected,
} from './lead-order-status.service';

/** Webhook natijasi (`checkout.elchi_webhook_event.result`). */
export type ElchiWebhookResult = 'APPLIED' | 'NOOP' | 'REJECTED' | 'IGNORED';

export interface ElchiWebhookOutcome {
  received: true;
  duplicate?: boolean;
  result?: ElchiWebhookResult;
  status?: LeadOrderStatus;
}

/**
 * Webhook o‘zi qo‘yadigan holatlar. «Elchi’ga topshirildi» ni topshirish akti qo‘yadi (BE-19 — ombor chiqimi shu
 * bilan), yig‘ish va qadoq — ombor. Shuning uchun Elchi xabari ombor bosqichlarini sakrab o‘tmaydi.
 */
const ELCHI_STEPS: ReadonlySet<LeadOrderStatus> = new Set([
  LeadOrderStatus.IN_TRANSIT,
  LeadOrderStatus.DELIVERED,
  LeadOrderStatus.REMITTED,
  LeadOrderStatus.REFUSED,
  LeadOrderStatus.RETURNING,
  LeadOrderStatus.CANCELLED,
]);

/** Rad etilgan posilka holatlari — Elchi rad to‘lovi shu buyurtmalarga tegishli. */
const REFUSAL_BRANCH: ReadonlySet<LeadOrderStatus> = new Set([
  LeadOrderStatus.REFUSED,
  LeadOrderStatus.RETURNING,
  LeadOrderStatus.RETURNED_GRADED,
]);

const ELCHI_ACTOR: LeadOrderActor = {
  type: LeadOrderActorType.ELCHI,
  id: null,
};

/**
 * Elchi webhooki lid buyurtmasi uchun (BE-21; TZ ELC-3, ELC-4, ELC-5, T9-6, T9-7).
 *
 * - Holat faqat oldinga: T5 grafida joriy holatdan maqsadgacha Elchi qadamlari bilan yo‘l bo‘lsa, har qadam alohida
 *   o‘tish (jurnal, `order.status.changed`); yo‘l bo‘lmasa — holat o‘zgarmaydi, jurnalga «rad etildi», Elchi’ga 200.
 * - Pul: `paid` / `partly_paid` va rad etilgan posilkadagi `extra_cost` — `finance.cod.settled` 2-versiya (BE-22).
 * - Hammasi bitta tranzaksiyada, moliya hodisalari outbox orqali (T9-3); takror — `event_id` bo‘yicha bir marta.
 */
@Injectable()
export class ElchiLeadWebhookService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly statuses: LeadOrderStatusService,
  ) {}

  /** `mp-order:<id>` — lid buyurtmasi (BE-20); aks holda null (eski do‘kon buyurtmasi). */
  orderIdOf(event: ElchiWebhookDto): string | null {
    return leadOrderIdFromElchiRef(event?.externalOrderId);
  }

  async process(event: ElchiWebhookDto): Promise<ElchiWebhookOutcome> {
    const orderId = this.orderIdOf(event);
    if (!orderId) throw new BadRequestException('Lid buyurtmasi kaliti emas');
    const commands: InventoryCommand[] = [];
    const outcome = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        event.eventId,
      ]);
      const duplicate = (await manager.query(
        'SELECT 1 FROM checkout.elchi_webhook_event WHERE event_id = $1',
        [event.eventId],
      )) as unknown[];
      if (duplicate.length) return { received: true as const, duplicate: true };

      // buyurtma qatori qulflanadi: yo‘l hisobi va o‘tishlar bir xil holatdan
      const [order] = (await manager.query(
        `SELECT o.status, p.id::text AS "parcelId", p.elchi_shipment_id::text AS "shipmentId"
           FROM checkout.sales_order o
           JOIN checkout.parcel p ON p.sales_order_id = o.id
          WHERE o.id = $1 AND o.source IS NOT NULL
          FOR UPDATE OF o`,
        [orderId],
      )) as Array<{
        status: LeadOrderStatus;
        parcelId: string;
        shipmentId: string | null;
      }>;
      if (!order) throw new NotFoundException('Webhook buyurtmasi topilmadi');
      if (order.shipmentId !== String(event.shipmentId))
        throw new BadRequestException('shipmentId buyurtmaga mos emas');

      const from = order.status;
      const target = this.targetOf(event.status, from);
      let result: ElchiWebhookResult;
      let detail: string | null = null;
      let status = from;
      if (target === null) {
        result = 'NOOP';
        detail = `holatga ta’siri yo‘q: ${event.status}`;
      } else if (target === from) {
        result = 'NOOP';
      } else {
        const path = forwardPath(from, target);
        if (!path) {
          // orqaga yoki boshqa tarmoq (masalan, «Yetkazildi» dan keyin «Yo‘lda») — o‘zgarmaydi (TC1)
          result = 'REJECTED';
          detail = `${from} → ${target}: faqat oldinga`;
          await this.statuses.recordRejected(
            new TransitionRejected(orderId, from, target),
            ELCHI_ACTOR,
            `Elchi webhook ${event.eventId}: ${event.status}`,
            manager,
          );
        } else {
          for (const to of path) {
            const applied = await this.statuses.applyTransition(manager, {
              orderId,
              to,
              actor: ELCHI_ACTOR,
              reason: `Elchi webhook ${event.eventId}: ${event.status}`,
            });
            if (applied.command) commands.push(applied.command);
          }
          result = 'APPLIED';
          status = target;
          if (path.length > 1) detail = `oraliq: ${path.join(' → ')}`;
        }
      }

      await this.recordMoney(manager, orderId, event, status);
      await manager.query(
        `INSERT INTO checkout.elchi_webhook_event
           (event_id, shipment_id, sales_order_seller_id, status, occurred_at, payload, result, detail, order_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
        [
          event.eventId,
          event.shipmentId,
          order.parcelId,
          event.status,
          event.occurredAt,
          JSON.stringify(event),
          result,
          detail,
          orderId,
        ],
      );
      return { received: true as const, result, status };
    });
    // bekor qilinganda band bo‘shaydi (BE-18): commit dan keyin darhol, o‘tmasa relay qayta yuboradi
    for (const command of commands)
      await this.statuses.sendInventoryNow(command);
    return outcome;
  }

  /**
   * Elchi holati → T5 maqsadi (null — buyurtma holatiga ta’siri yo‘q). «Bekor»: topshirilgunga qadar — bekor qilindi
   * (band bo‘shaydi), topshirilgandan keyin — mijoz rad etdi [taklif, egaga savol 1].
   */
  private targetOf(
    elchiStatus: ElchiWebhookDto['status'],
    current: LeadOrderStatus,
  ): LeadOrderStatus | null {
    switch (elchiStatus) {
      case 'shipment_created':
      case 'received':
        // akt qo‘yadi; akt yopilmagan bo‘lsa — oldinga yo‘l yo‘q (rad, jurnalda)
        return LeadOrderStatus.HANDED_TO_ELCHI;
      case 'on_the_road':
        return LeadOrderStatus.IN_TRANSIT;
      case 'delivered':
      case 'sold':
      case 'partly_paid':
        return LeadOrderStatus.DELIVERED;
      case 'paid':
      case 'settled':
        return LeadOrderStatus.REMITTED;
      case 'returned':
        return LeadOrderStatus.RETURNING;
      case 'cancelled':
      case 'canceled':
        return LEAD_ORDER_CANCELLABLE.includes(current)
          ? LeadOrderStatus.CANCELLED
          : LeadOrderStatus.REFUSED;
      case 'closed':
      default:
        return null;
    }
  }

  /**
   * Elchi pul ma’lumoti moliyaga (`finance.cod.settled` 2-versiya, outbox — buyurtma hodisalari bilan bir oqimda,
   * shuning uchun «Yetkazildi» dan keyin keladi). Moliya buyurtma jurnali bilan solishtiradi (BE-22).
   */
  private async recordMoney(
    manager: EntityManager,
    orderId: string,
    event: ElchiWebhookDto,
    status: LeadOrderStatus,
  ): Promise<void> {
    let remittance: FinanceRemittanceEvent | null = null;
    const base = {
      schemaVersion: 2 as const,
      eventId: event.eventId,
      orderId,
      shipmentId: event.shipmentId,
      collectedFromCustomer: event.collectedFromCustomer ?? 0,
      elchiFee: event.elchiFee ?? 0,
      marketPaidAmount: event.marketPaidAmount ?? 0,
      occurredAt: event.occurredAt,
    };
    if (event.status === 'paid' || event.status === 'partly_paid') {
      remittance = { ...base, elchiStatus: event.status, refusalFee: null };
    } else if (
      (event.status === 'cancelled' ||
        event.status === 'canceled' ||
        event.status === 'returned' ||
        event.status === 'closed') &&
      event.extraCost !== undefined &&
      REFUSAL_BRANCH.has(status)
    ) {
      // rad etilgan posilka: Elchi ushlagan xarajat — rad to‘lovi [taklif, egaga savol 2]; moliya 20 000 bilan solishtiradi
      remittance = {
        ...base,
        elchiStatus: 'closed',
        refusalFee: event.extraCost,
      };
    }
    if (!remittance) return;
    await this.outbox.record(
      {
        // buyurtma hodisalari bilan bitta oqim: relay tartibni saqlaydi
        aggregateType: 'sales_order',
        aggregateId: orderId,
        eventType: 'finance.cod.settled',
        payload: remittance as unknown as Record<string, unknown>,
      },
      manager,
    );
  }
}

/**
 * Joriy holatdan maqsadgacha faqat Elchi qadamlari bilan oldinga yo‘l (T5 grafi, BFS). Yo‘q bo‘lsa — null.
 * Masalan: topshirildi → yetkazildi = [yo‘lda, yetkazildi] («Yo‘lda» xabari yo‘qolgan bo‘lsa ham).
 */
export function forwardPath(
  from: LeadOrderStatus,
  to: LeadOrderStatus,
): LeadOrderStatus[] | null {
  const previous = new Map<LeadOrderStatus, LeadOrderStatus>();
  const queue: LeadOrderStatus[] = [from];
  const seen = new Set<LeadOrderStatus>([from]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current === to) {
      const path: LeadOrderStatus[] = [];
      for (let step = to; step !== from; step = previous.get(step)!)
        path.unshift(step);
      return path;
    }
    for (const next of LEAD_ORDER_TRANSITIONS[current] ?? []) {
      if (!ELCHI_STEPS.has(next) || seen.has(next)) continue;
      // «bekor qilindi» faqat to‘g‘ridan-to‘g‘ri (topshirilgunga qadar), oraliq qadam emas
      if (next === LeadOrderStatus.CANCELLED && to !== next) continue;
      seen.add(next);
      previous.set(next, current);
      queue.push(next);
    }
  }
  return null;
}
