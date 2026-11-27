import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { DataSource, EntityManager } from 'typeorm';
import {
  ELCHI_STATUS_CONFLICT_EVENT,
  ElchiStatusConflictEvent,
  ElchiWebhookDto,
  FinanceRemittanceEvent,
  LEAD_ORDER_CANCELLABLE,
  LEAD_ORDER_TRANSITIONS,
  LeadOrderActor,
  LeadOrderActorType,
  LeadOrderStatus,
  leadOrderIdFromElchiRef,
  OutboxService,
  RmqClient,
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

/** Rad etilgan yoki bekor qilingan buyurtma — Elchi «bekor»/«qaytdi» xabari endi o‘zgartirmaydi (takror). */
const CLOSED_WITHOUT_SALE: ReadonlySet<LeadOrderStatus> = new Set([
  LeadOrderStatus.CANCELLED,
  LeadOrderStatus.REFUSED,
  LeadOrderStatus.RETURNING,
  LeadOrderStatus.RETURNED_GRADED,
]);

/** Rad etilgan posilka holatlari — Elchi rad to‘lovi shu buyurtmalarga tegishli. */
const REFUSAL_BRANCH: ReadonlySet<LeadOrderStatus> = new Set([
  LeadOrderStatus.REFUSED,
  LeadOrderStatus.RETURNING,
  LeadOrderStatus.RETURNED_GRADED,
]);

/** Sotuv yoki pul haqidagi Elchi xabarlari — rad etilsa, pul yo‘qolmasin: xabar beriladi. */
const SALE_OR_MONEY: ReadonlySet<string> = new Set([
  'sold',
  'delivered',
  'paid',
  'partly_paid',
]);

/** Yetkazilgan (sotilgan) buyurtma — Elchi uni bekor qilsa, bu sotuvni orqaga qaytarish. */
const SOLD: ReadonlySet<LeadOrderStatus> = new Set([
  LeadOrderStatus.DELIVERED,
  LeadOrderStatus.REMITTED,
  LeadOrderStatus.SETTLED,
  LeadOrderStatus.RETURN_REQUESTED,
]);

const ELCHI_ACTOR: LeadOrderActor = {
  type: LeadOrderActorType.ELCHI,
  id: null,
};

/** Xabar navbati ishlamasa webhook javobi kechikmasin. */
const NOTIFY_TIMEOUT_MS = 2_000;

/**
 * Elchi webhooki lid buyurtmasi uchun (BE-21; TZ ELC-3, ELC-4, ELC-5, T9-6, T9-7).
 *
 * - Holat faqat oldinga: T5 grafida joriy holatdan maqsadgacha Elchi qadamlari bilan yo‘l bo‘lsa, har qadam alohida
 *   o‘tish (jurnal, `order.status.changed`); yo‘l bo‘lmasa — holat o‘zgarmaydi, jurnalga «rad etildi», Elchi’ga 200.
 *   Elchi yetkazilgan sotuvni bekor qilsa — moliya va nazoratchiga xabar (pul HOLD da, qo‘lda hal qilinadi).
 * - Pul: `paid` / `partly_paid` va rad etilgan posilkadagi `extra_cost` — `finance.cod.settled` 2-versiya (BE-22).
 * - Hammasi bitta tranzaksiyada, moliya hodisalari outbox orqali (T9-3); takror — `event_id` bo‘yicha bir marta.
 */
@Injectable()
export class ElchiLeadWebhookService {
  private readonly logger = new Logger(ElchiLeadWebhookService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly statuses: LeadOrderStatusService,
    @Inject(RmqClient.NOTIFICATION) private readonly notifications: ClientProxy,
  ) {}

  /** `mp-order:<id>` — lid buyurtmasi (BE-20); aks holda null (eski do‘kon buyurtmasi). */
  orderIdOf(event: ElchiWebhookDto): string | null {
    return leadOrderIdFromElchiRef(event?.externalOrderId);
  }

  async process(event: ElchiWebhookDto): Promise<ElchiWebhookOutcome> {
    const orderId = this.orderIdOf(event);
    if (!orderId) throw new BadRequestException('Lid buyurtmasi kaliti emas');
    const commands: InventoryCommand[] = [];
    let rollback: ElchiStatusConflictEvent | null = null;
    const outcome = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        event.eventId,
      ]);
      const duplicate = (await manager.query(
        'SELECT 1 FROM checkout.elchi_webhook_event WHERE event_id = $1',
        [event.eventId],
      )) as unknown[];
      if (duplicate.length) return { received: true as const, duplicate: true };

      // buyurtma qatori qulflanadi (tartib: buyurtma, keyin vazifa — topshirish akti bilan bir xil)
      const [order] = (await manager.query(
        `SELECT o.status, p.id::text AS "parcelId"
           FROM checkout.sales_order o
           JOIN checkout.parcel p ON p.sales_order_id = o.id
          WHERE o.id = $1 AND o.source IS NOT NULL AND p.elchi_shipment_id = $2::bigint
          FOR UPDATE OF o`,
        [orderId, event.shipmentId],
      )) as Array<{ status: LeadOrderStatus; parcelId: string }>;
      if (!order) {
        const exists = (await manager.query(
          'SELECT 1 FROM checkout.sales_order WHERE id = $1 AND source IS NOT NULL',
          [orderId],
        )) as unknown[];
        if (!exists.length)
          throw new NotFoundException('Webhook buyurtmasi topilmadi');
        throw new BadRequestException('shipmentId buyurtmaga mos emas');
      }

      const from = order.status;
      // qaytarish tasdiqlangan (BE-44: RETURN_REQUESTED orqali RETURNING) — keyin kelgan «sotildi»/«to‘landi» holatni
      // o‘zgartirmaydi, pul esa moliyaga yoziladi (aks holda Elchi o‘tkazgan pul yo‘qolardi; QA-02 tekshiruvi)
      const returnedAfterDelivery =
        (from === LeadOrderStatus.RETURNING ||
          from === LeadOrderStatus.RETURNED_GRADED) &&
        SALE_OR_MONEY.has(event.status) &&
        (
          (await manager.query(
            `SELECT 1 FROM checkout.order_status_history
              WHERE order_id = $1 AND to_status = 'RETURN_REQUESTED' AND accepted = TRUE LIMIT 1`,
            [orderId],
          )) as unknown[]
        ).length > 0;
      const target = returnedAfterDelivery
        ? null
        : this.targetOf(event.status, from);
      let result: ElchiWebhookResult;
      let detail: string | null = null;
      let status = from;
      let path: LeadOrderStatus[] = [];
      if (target === null) {
        result = 'NOOP';
        detail = `holatga ta’siri yo‘q: ${event.status} (${from})`;
      } else if (target === from) {
        result = 'NOOP';
      } else {
        const found = forwardPath(from, target);
        if (!found) {
          // orqaga yoki boshqa tarmoq (masalan, «Yetkazildi» dan keyin «Yo‘lda») — o‘zgarmaydi (TC1)
          result = 'REJECTED';
          detail = `${from} → ${target}: faqat oldinga`;
          await this.statuses.recordRejected(
            new TransitionRejected(orderId, from, target),
            ELCHI_ACTOR,
            `Elchi webhook ${event.eventId}: ${event.status}`,
            manager,
          );
          // zid xabar: yetkazilgan sotuv bekor qilindi, rad etilgan/topshirilmagan buyurtmaga «sotildi»/«to‘landi»
          const conflict =
            (SOLD.has(from) &&
              (target === LeadOrderStatus.REFUSED ||
                target === LeadOrderStatus.RETURNING)) ||
            SALE_OR_MONEY.has(event.status);
          // bitta buyurtma uchun bir marta (Elchi bekor qilishni bir necha xabar bilan yuboradi)
          const alerted =
            conflict &&
            (
              (await manager.query(
                `SELECT 1 FROM checkout.elchi_webhook_event
                WHERE order_id = $1 AND result = 'REJECTED' LIMIT 1`,
                [orderId],
              )) as unknown[]
            ).length > 0;
          if (conflict && !alerted)
            rollback = {
              orderId,
              shipmentId: event.shipmentId,
              orderStatus: from,
              elchiStatus: event.status,
              eventId: event.eventId,
              occurredAt: event.occurredAt,
            };
        } else {
          path = found;
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

      // rad etilgan o‘tishda pul yozilmaydi: moliyada mos keladigan buyurtma hodisasi bo‘lmaydi
      if (result !== 'REJECTED')
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
    if (rollback) await this.notifyConflict(rollback);
    return outcome;
  }

  /**
   * Elchi holati → T5 maqsadi (null — buyurtma holatiga ta’siri yo‘q, jurnalda NOOP).
   * «Bekor»: topshirilgunga qadar — bekor qilindi (band bo‘shaydi), topshirilgandan keyin — mijoz rad etdi
   * [taklif, egaga savol 1]; allaqachon bekor yoki rad etilgan — takror.
   */
  private targetOf(
    elchiStatus: ElchiWebhookDto['status'],
    current: LeadOrderStatus,
  ): LeadOrderStatus | null {
    // qaytarish so‘rovi ochiq (BE-44): buyurtma allaqachon yetkazilgan, keyingi holatni xodim qarori belgilaydi —
    // «sotildi»/«to‘landi» holatni o‘zgartirmaydi (zid emas, xabar yo‘q), lekin pul moliyaga yoziladi (recordMoney):
    // mijoz pulni yetkazishda to‘lagan, qaytarish tasdiqlansa moliya `order.returned` bilan qaytaradi
    if (
      current === LeadOrderStatus.RETURN_REQUESTED &&
      SALE_OR_MONEY.has(elchiStatus)
    )
      return null;
    switch (elchiStatus) {
      case 'on_the_road':
        return LeadOrderStatus.IN_TRANSIT;
      case 'delivered':
      case 'sold':
      case 'partly_paid':
        return LeadOrderStatus.DELIVERED;
      case 'paid':
        return LeadOrderStatus.REMITTED;
      case 'returned':
        return CLOSED_WITHOUT_SALE.has(current) &&
          current !== LeadOrderStatus.REFUSED
          ? null
          : LeadOrderStatus.RETURNING;
      case 'cancelled':
      case 'canceled':
        if (LEAD_ORDER_CANCELLABLE.includes(current))
          return LeadOrderStatus.CANCELLED;
        return CLOSED_WITHOUT_SALE.has(current)
          ? null
          : LeadOrderStatus.REFUSED;
      // «Elchi’ga topshirildi» ni topshirish akti qo‘yadi (BE-19); `settled` — marketplace shaklidagi eski nom,
      // pul summalarisiz; `closed` — asosan bekor qilingan tovarning yakuniy holati (pul — recordMoney da)
      case 'shipment_created':
      case 'received':
      case 'settled':
      case 'closed':
      default:
        return null;
    }
  }

  /**
   * Elchi pul ma’lumoti moliyaga (`finance.cod.settled` 2-versiya, outbox — buyurtma hodisalari bilan bir oqimda).
   * Moliya buyurtma jurnali bilan solishtiradi (BE-22); bir xil summa takrori — mos.
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
      (event.extraCost ?? 0) > 0 &&
      // rad etilgan posilka: Elchi ushlagan xarajat — rad to‘lovi [taklif, egaga savol 2]. Elchi `extra_cost` ni
      // har xabarda yuboradi (odatda 0) — faqat musbat summa; kuryer uni keyingi xabarda kiritishi mumkin, shuning
      // uchun rad tarmog‘idagi har xabarda (moliya bir xil summa takrorini mos deb oladi).
      REFUSAL_BRANCH.has(status)
    ) {
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

  /** Elchi yetkazilgan sotuvni bekor qildi — moliya va nazoratchiga (webhook jurnalida REJECTED ham turadi). */
  private async notifyConflict(event: ElchiStatusConflictEvent): Promise<void> {
    this.logger.warn(
      `Elchi sotuvni orqaga qaytardi: buyurtma ${event.orderId} (${event.orderStatus}), Elchi ${event.elchiStatus}`,
    );
    await firstValueFrom(
      this.notifications
        .emit(ELCHI_STATUS_CONFLICT_EVENT, event)
        .pipe(timeout(NOTIFY_TIMEOUT_MS)),
      { defaultValue: undefined },
    ).catch((error: unknown) =>
      this.logger.error(
        `Sotuv qaytarilgani haqida xabar yuborilmadi (${event.orderId}): ${(error as Error)?.message}`,
      ),
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
