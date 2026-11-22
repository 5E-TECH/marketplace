import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import { firstValueFrom, timeout } from 'rxjs';
import { DataSource, EntityManager } from 'typeorm';
import {
  CheckoutDeliveryDestination,
  ErrorCode,
  isLeadOrderTransitionAllowed,
  LEAD_RETURN_TRANSITIONS,
  LeadOrderActor,
  LeadOrderActorType,
  LeadOrderStatus,
  LeadOrderTransitionInput,
  ORDER_EVENTS,
  OrderStatusChangedEvent,
  OutboxService,
  RmqClient,
} from '@app/common';

const ID = /^[1-9]\d{0,18}$/;
const STATUSES = new Set<string>(Object.values(LeadOrderStatus));
/** Ombor buyrug‘ining outbox oqimi (holat hodisalaridan alohida). */
export const INVENTORY_COMMAND_AGGREGATE = 'inventory_command';
const IMMEDIATE_INVENTORY_TIMEOUT_MS = 2_000;
/** Bekor qilish sababi (BUY-3) — bo‘sh yoki «.» emas. */
const MIN_REASON = 3;

/** Ruxsatsiz o‘tish (BUY-2): 409; jurnalga tranzaksiyadan keyin yoziladi. */
export class TransitionRejected extends ConflictException {
  constructor(
    readonly orderId: string,
    readonly from: LeadOrderStatus,
    readonly to: LeadOrderStatus,
  ) {
    super({
      message: `Holatni o‘zgartirib bo‘lmaydi: ${from} → ${to}`,
      errorCode: ErrorCode.INVALID_STATE,
    });
  }
}

export interface AppliedTransition {
  result: LeadOrderTransitionResult;
  command: InventoryCommand | null;
}

export interface LeadOrderTransitionResult {
  id: string;
  status: LeadOrderStatus;
  previousStatus: LeadOrderStatus;
  /** Buyurtma allaqachon shu holatda — hech narsa o‘zgarmadi. */
  idempotent: boolean;
}

/** Jurnal yozuvi uchun aktor (tizim — liddan yaratish). */
export const SYSTEM_ACTOR: LeadOrderActor = {
  type: LeadOrderActorType.SYSTEM,
  id: null,
};

/**
 * Lid buyurtmasining holatlari (BE-18, TZ BUY-2, T5): faqat ruxsat etilgan o‘tish; rad etilgani ham jurnalda.
 * Har o‘tishda `order.status.changed` outbox orqali (relay moliya, lid va Elchi integratsiyasi navbatlariga).
 *
 * Ombor bilan bog‘liq qadamlar: bekor qilinganda band bo‘shaydi (BUY-3), Elchi’ga topshirilganda band chiqimga
 * aylanadi (BE-16 «chiqim topshirishda»). Ombor buyrug‘i holat bilan BITTA tranzaksiyada outbox’ga yoziladi va commit
 * dan keyin darhol yuboriladi; ombor javob bermasa, relay qayta yuboradi (idempotent kalit — ikki marta yozilmaydi).
 * Shunda holat va ombor bir-biridan ajralib qolmaydi: holat o‘zgargan bo‘lsa, ombor buyrug‘i albatta yetadi.
 */
@Injectable()
export class LeadOrderStatusService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
  ) {}

  async transition(
    input: LeadOrderTransitionInput,
  ): Promise<LeadOrderTransitionResult> {
    const { orderId, to, actor, reason } = this.validate(input);
    let applied: AppliedTransition;
    try {
      applied = await this.dataSource.transaction((manager) =>
        this.applyTransition(manager, { orderId, to, actor, reason }),
      );
    } catch (error) {
      if (error instanceof TransitionRejected)
        await this.recordRejected(error, actor, reason);
      throw error;
    }
    await this.sendInventoryNow(applied.command);
    return applied.result;
  }

  /**
   * O‘tish chaqiruvchining tranzaksiyasida (BE-19: skaner, qadoq va topshirish akti buyurtma holati bilan birga).
   * Ruxsatsiz o‘tish — `TransitionRejected` (tranzaksiya qaytadi; jurnalga `recordRejected` bilan alohida yoziladi).
   * Ombor buyrug‘i outbox’ga yoziladi; commit dan keyin `sendInventoryNow` bilan darhol yuborish chaqiruvchida.
   */
  async applyTransition(
    manager: EntityManager,
    input: {
      orderId: string;
      to: LeadOrderStatus;
      actor: LeadOrderActor;
      reason: string | null;
      /** BE-44: qaytarish so‘rovi qarori — `LEAD_RETURN_TRANSITIONS` ham ruxsat (faqat LeadReturnService). */
      returnDecision?: boolean;
    },
  ): Promise<AppliedTransition> {
    const { orderId, to, actor, reason } = input;
    const [order] = (await manager.query(
      `SELECT status FROM checkout.sales_order
        WHERE id = $1 AND source IS NOT NULL FOR UPDATE`,
      [orderId],
    )) as Array<{ status: LeadOrderStatus }>;
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const from = order.status;
    if (from === to)
      return {
        result: {
          id: orderId,
          status: to,
          previousStatus: from,
          idempotent: true,
        },
        command: null,
      };
    if (
      !isLeadOrderTransitionAllowed(from, to) &&
      !(input.returnDecision && LEAD_RETURN_TRANSITIONS[from]?.includes(to))
    )
      throw new TransitionRejected(orderId, from, to);
    const command = inventoryCommand(orderId, to, actor, reason);
    if (command)
      await this.outbox.record(
        {
          // o‘z oqimi: ombor ishlamasa ham holat hodisasi (Elchi posilkasini bekor qilish) to‘xtab qolmasin
          aggregateType: INVENTORY_COMMAND_AGGREGATE,
          aggregateId: orderId,
          eventType: command.cmd,
          payload: command.payload,
        },
        manager,
      );
    await manager.query(
      `UPDATE checkout.sales_order SET status = $2, updated_at = now() WHERE id = $1`,
      [orderId, to],
    );
    await this.syncTask(manager, orderId, to, actor);
    await this.journal(manager, orderId, from, to, true, actor, reason);
    await this.emit(manager, orderId, from, to);
    return {
      result: {
        id: orderId,
        status: to,
        previousStatus: from,
        idempotent: false,
      },
      command,
    };
  }

  /**
   * BE-19: yig‘ish vazifasi buyurtma bilan bir xil turadi, holat qaysi yo‘l bilan o‘zgarmasin (ombor, Elchi webhook
   * BE-21, moliya): bekor — vazifa bekor; qadoqlandi — qadoqlangan; Elchi’ga topshirildi va undan keyingi holat —
   * topshirilgan. Ombor yo‘llari vazifani o‘zi yangilaydi — bu yerda faqat orqada qolgan vazifa tortiladi.
   */
  private async syncTask(
    manager: EntityManager,
    orderId: string,
    to: LeadOrderStatus,
    actor: LeadOrderActor,
  ): Promise<void> {
    if (to === LeadOrderStatus.CANCELLED) {
      await manager.query(
        `UPDATE checkout.fulfillment_task SET status = 'CANCELLED', updated_at = now()
          WHERE order_id = $1 AND status <> 'HANDED_OVER'`,
        [orderId],
      );
      return;
    }
    if (to === LeadOrderStatus.PACKED) {
      await manager.query(
        `UPDATE checkout.fulfillment_task
            SET status = 'PACKED', picked_qty = required_qty,
                packed_at = COALESCE(packed_at, now()), packed_by = COALESCE(packed_by, $2::bigint),
                updated_at = now()
          WHERE order_id = $1 AND status IN ('TO_PICK', 'PICKED')`,
        [orderId, actor.id],
      );
      return;
    }
    if (to !== LeadOrderStatus.PICKING && to !== LeadOrderStatus.CONFIRMED)
      await manager.query(
        `UPDATE checkout.fulfillment_task
            SET status = 'HANDED_OVER', picked_qty = required_qty,
                handed_over_at = COALESCE(handed_over_at, now()),
                handed_over_by = COALESCE(handed_over_by, $2::bigint), updated_at = now()
          WHERE order_id = $1 AND status IN ('TO_PICK', 'PICKED', 'PACKED')`,
        [orderId, actor.id],
      );
  }

  /** BUY-2: rad etilgan o‘tish jurnalga — asosiy tranzaksiya qaytgandan keyin, alohida. */
  async recordRejected(
    rejected: TransitionRejected,
    actor: LeadOrderActor,
    reason: string | null,
  ): Promise<void> {
    await this.journal(
      this.dataSource.manager,
      rejected.orderId,
      rejected.from,
      rejected.to,
      false,
      actor,
      reason,
    );
  }

  /**
   * BUY-3 «darhol»: commit dan keyin bitta qisqa urinish; o‘tmasa outbox relay qayta yuboradi (≤ 10 s oralig‘ida).
   * Qisqa kutish: gateway javobi (10 s) ombor ortidan kechikmasin — holat allaqachon saqlangan.
   */
  async sendInventoryNow(command: InventoryCommand | null): Promise<void> {
    if (!command) return;
    await firstValueFrom(
      this.inventory
        .send({ cmd: command.cmd }, command.payload)
        .pipe(timeout(IMMEDIATE_INVENTORY_TIMEOUT_MS)),
    ).catch(() => undefined);
  }

  /** Kirishni tekshiradi: buyurtma ID, holat, aktor; bekor qilishda sabab majburiy. */
  validate(input: LeadOrderTransitionInput): {
    orderId: string;
    to: LeadOrderStatus;
    actor: LeadOrderActor;
    reason: string | null;
  } {
    const orderId = String(input?.orderId ?? '');
    if (!ID.test(orderId)) throw new NotFoundException('Buyurtma topilmadi');
    const to = input?.to;
    if (!STATUSES.has(String(to)))
      throw new BadRequestException(`Noma’lum holat: ${String(to)}`);
    const actor = this.actorOf(input?.actor);
    const reason = input?.reason?.trim() || null;
    if (to === LeadOrderStatus.CANCELLED && (reason?.length ?? 0) < MIN_REASON)
      throw new BadRequestException('Bekor qilish sababi majburiy');
    return { orderId, to, actor, reason };
  }

  /** BUY-3: Elchi’ga topshirilgunga qadar, sabab bilan; band tovar darhol bo‘shaydi. */
  cancel(input: {
    orderId: string;
    reason: string;
    actor: LeadOrderActor;
  }): Promise<LeadOrderTransitionResult> {
    return this.transition({
      orderId: input?.orderId,
      to: LeadOrderStatus.CANCELLED,
      actor: input?.actor,
      reason: input?.reason,
    });
  }

  /** Buyurtma lid buyurtmasimi (manbasi bor) — eski admin yo‘llari shunga qarab tarmoqlanadi. */
  async isLeadOrder(orderId: string): Promise<boolean> {
    if (!ID.test(String(orderId ?? ''))) return false;
    const rows = (await this.dataSource.query(
      `SELECT 1 FROM checkout.sales_order WHERE id = $1 AND source IS NOT NULL`,
      [String(orderId)],
    )) as unknown[];
    return rows.length > 0;
  }

  async journal(
    manager: EntityManager,
    orderId: string,
    from: LeadOrderStatus | null,
    to: LeadOrderStatus,
    accepted: boolean,
    actor: LeadOrderActor,
    reason: string | null,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO checkout.order_status_history
         (order_id, from_status, to_status, accepted, actor_type, actor_id, actor_role, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        orderId,
        from,
        to,
        accepted,
        actor.type,
        actor.id,
        actor.role ?? null,
        reason,
      ],
    );
  }

  /** `order.status.changed` — to‘liq maydonlar (iste’molchilar checkout bazasiga murojaat qilmaydi, BE-25). */
  async emit(
    manager: EntityManager,
    orderId: string,
    previousStatus: LeadOrderStatus | null,
    status: LeadOrderStatus,
  ): Promise<OrderStatusChangedEvent> {
    const event = await this.buildEvent(
      manager,
      orderId,
      previousStatus,
      status,
    );
    await this.outbox.record(
      {
        aggregateType: 'sales_order',
        aggregateId: orderId,
        eventType: ORDER_EVENTS.STATUS_CHANGED,
        payload: event as unknown as Record<string, unknown>,
      },
      manager,
    );
    return event;
  }

  async buildEvent(
    manager: EntityManager,
    orderId: string,
    previousStatus: LeadOrderStatus | null,
    status: LeadOrderStatus,
  ): Promise<OrderStatusChangedEvent> {
    const [order] = (await manager.query(
      `SELECT o.id::text AS id, o.lead_id::text AS "leadId", o.source,
              o.stream_id::text AS "streamId", o.affiliate_id::text AS "affiliateId",
              o.wholesaler_id::text AS "wholesalerId", o.buyer_name AS "buyerName",
              o.customer_phone AS "customerPhone", o.region_soato AS "regionSoato",
              o.district_soato AS "districtSoato", o.delivery_address AS "addressLine",
              o.where_deliver AS "whereDeliver", o.delivery_mode AS "deliveryMode",
              o.delivery_shown::text AS "deliveryShown", o.delivery_cost::text AS "deliveryCost",
              o.cod_amount::text AS "codAmount"
         FROM checkout.sales_order o WHERE o.id = $1`,
      [orderId],
    )) as Array<Record<string, string | null>>;
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const items = (await manager.query(
      `SELECT i.product_id::text AS "productId", COALESCE(i.wholesaler_id, s.shop_id)::text AS "wholesalerId", i.sku,
              i.product_name AS name, i.quantity, i.weight_grams AS "weightGrams",
              i.approved_price::text AS "approvedPrice", i.base_price::text AS "basePrice",
              i.unit_price::text AS "salePrice", i.affiliate_fee::text AS "affiliateFee",
              i.call_center_fee::text AS "callCenterFee", i.hidden_delivery::text AS "hiddenDelivery",
              i.platform_service::text AS "platformService"
         FROM checkout.sales_order_item i
         JOIN checkout.parcel s ON s.id = i.sales_order_seller_id
        WHERE s.sales_order_id = $1
        ORDER BY i.id`,
      [orderId],
    )) as Array<Record<string, string | number | null>>;
    const [parcel] = (await manager.query(
      `SELECT elchi_shipment_id::text AS "shipmentId", tracking_url AS "trackingUrl"
         FROM checkout.parcel
        WHERE sales_order_id = $1 AND elchi_shipment_id IS NOT NULL
        ORDER BY id LIMIT 1`,
      [orderId],
    )) as Array<{ shipmentId: string; trackingUrl: string | null }>;
    const n = (v: unknown) => Number(v ?? 0);
    return {
      eventId: randomUUID(),
      orderId: String(order.id),
      orderNumber: leadOrderNumber(String(order.id)),
      leadId: order.leadId,
      source: order.source as OrderStatusChangedEvent['source'],
      streamId: order.streamId,
      affiliateId: order.affiliateId,
      wholesalerId: order.wholesalerId,
      status,
      previousStatus,
      recipient: {
        name: String(order.buyerName ?? ''),
        phone: String(order.customerPhone ?? ''),
        regionSoato: String(order.regionSoato ?? ''),
        districtSoato: String(order.districtSoato ?? ''),
        addressLine: String(order.addressLine ?? ''),
        whereDeliver: order.whereDeliver as CheckoutDeliveryDestination,
      },
      items: items.map((item) => {
        const quantity = n(item.quantity);
        return {
          productId: String(item.productId),
          wholesalerId: item.wholesalerId ? String(item.wholesalerId) : null,
          sku: (item.sku as string | null) ?? null,
          name: String(item.name ?? ''),
          quantity,
          weightGrams: item.weightGrams == null ? null : n(item.weightGrams),
          approvedPrice: n(item.approvedPrice),
          basePrice: n(item.basePrice),
          salePrice: n(item.salePrice),
          // taqsimot — tovar qatori uchun JAMI (shartnoma, BE-22)
          split: {
            affiliateFee: n(item.affiliateFee) * quantity,
            callCenterFee: n(item.callCenterFee) * quantity,
            hiddenDelivery: n(item.hiddenDelivery) * quantity,
            platformService: n(item.platformService) * quantity,
          },
        };
      }),
      delivery: {
        mode: order.deliveryMode as OrderStatusChangedEvent['delivery']['mode'],
        cost: n(order.deliveryShown),
        elchiTariff: n(order.deliveryCost),
      },
      codAmount: n(order.codAmount),
      parcel: parcel
        ? {
            shipmentId: parcel.shipmentId,
            trackingUrl: parcel.trackingUrl ?? null,
          }
        : null,
      occurredAt: new Date().toISOString(),
    };
  }

  private actorOf(actor: LeadOrderActor | undefined): LeadOrderActor {
    const type = Object.values(LeadOrderActorType).includes(
      actor?.type as LeadOrderActorType,
    )
      ? (actor!.type as LeadOrderActorType)
      : null;
    if (!type) throw new BadRequestException('Kim o‘zgartirayotgani noma’lum');
    const id = actor?.id == null ? null : String(actor.id);
    if (type === LeadOrderActorType.USER && (!id || !ID.test(id)))
      throw new BadRequestException('Foydalanuvchi ID si noto‘g‘ri');
    return {
      type,
      id: type === LeadOrderActorType.USER ? id : null,
      role: actor?.role ? String(actor.role).slice(0, 20) : null,
    };
  }
}

export interface InventoryCommand {
  cmd: 'inventory.release' | 'inventory.commit';
  payload: Record<string, unknown>;
}

/** Holat o‘tishiga mos ombor buyrug‘i (idempotent kalit bilan); boshqa o‘tishlarda — yo‘q. */
export function inventoryCommand(
  orderId: string,
  to: LeadOrderStatus,
  actor: LeadOrderActor,
  reason: string | null,
): InventoryCommand | null {
  if (to === LeadOrderStatus.CANCELLED)
    return {
      cmd: 'inventory.release',
      payload: {
        orderRef: orderId,
        idempotencyKey: `lead-order-cancel:${orderId}`,
        ...(reason ? { reason } : {}),
        ...(actor.id ? { actorId: actor.id } : {}),
      },
    };
  if (to === LeadOrderStatus.HANDED_TO_ELCHI)
    return {
      cmd: 'inventory.commit',
      payload: {
        orderRef: orderId,
        idempotencyKey: `lead-order-handover:${orderId}`,
        ...(actor.id ? { actorId: actor.id } : {}),
      },
    };
  return null;
}

/** Odamga ko‘rinadigan lid buyurtmasi raqami (shartnoma namunasi «L-1183»). */
export function leadOrderNumber(orderId: string): string {
  return `L-${orderId}`;
}
