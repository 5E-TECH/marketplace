import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  BusinessException,
  CheckoutDeliveryDestination,
  isLeadOrderTransitionAllowed,
  LeadOrderActor,
  LeadOrderActorType,
  LeadOrderStatus,
  LeadOrderTransitionInput,
  ORDER_EVENTS,
  OrderStatusChangedEvent,
  OutboxService,
  RmqClient,
  sendRpc,
} from '@app/common';

const ID = /^[1-9]\d{0,18}$/;
const STATUSES = new Set<string>(Object.values(LeadOrderStatus));
/** Bekor qilish sababi (BUY-3) — bo‘sh yoki «.» emas. */
const MIN_REASON = 3;

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
 * Ombor bilan bog‘liq qadamlar shu yerda: bekor qilinganda band darhol bo‘shaydi (BUY-3), Elchi’ga topshirilganda
 * band chiqimga aylanadi (BE-16 «chiqim topshirishda»). Inventory chaqiruvi buyurtma qatori qulflangan
 * tranzaksiya ichida: u yiqilsa holat ham o‘zgarmaydi; idempotent kalit qayta urinishda ikki marta yozmaydi.
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
    const orderId = String(input?.orderId ?? '');
    if (!ID.test(orderId)) throw new NotFoundException('Buyurtma topilmadi');
    const to = input?.to;
    if (!STATUSES.has(String(to)))
      throw new BadRequestException(`Noma’lum holat: ${String(to)}`);
    const actor = this.actorOf(input?.actor);
    const reason = input?.reason?.trim() || null;
    if (to === LeadOrderStatus.CANCELLED && (reason?.length ?? 0) < MIN_REASON)
      throw new BadRequestException('Bekor qilish sababi majburiy');

    const outcome: { rejected?: LeadOrderStatus } = {};
    const result = await this.dataSource.transaction(async (manager) => {
      const [order] = (await manager.query(
        `SELECT status FROM checkout.sales_order
          WHERE id = $1 AND source IS NOT NULL FOR UPDATE`,
        [orderId],
      )) as Array<{ status: LeadOrderStatus }>;
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      const from = order.status;
      if (from === to)
        return {
          id: orderId,
          status: to,
          previousStatus: from,
          idempotent: true,
        };
      if (!isLeadOrderTransitionAllowed(from, to)) {
        outcome.rejected = from;
        return null;
      }
      if (to === LeadOrderStatus.CANCELLED)
        await sendRpc(
          this.inventory,
          { cmd: 'inventory.release' },
          {
            orderRef: orderId,
            idempotencyKey: `lead-order-cancel:${orderId}`,
            reason: reason ?? undefined,
            actorId: actor.id ?? undefined,
          },
        );
      if (to === LeadOrderStatus.HANDED_TO_ELCHI)
        await sendRpc(
          this.inventory,
          { cmd: 'inventory.commit' },
          {
            orderRef: orderId,
            idempotencyKey: `lead-order-handover:${orderId}`,
            actorId: actor.id ?? undefined,
          },
        );
      await manager.query(
        `UPDATE checkout.sales_order SET status = $2, updated_at = now() WHERE id = $1`,
        [orderId, to],
      );
      await this.journal(manager, orderId, from, to, true, actor, reason);
      await this.emit(manager, orderId, from, to);
      return {
        id: orderId,
        status: to,
        previousStatus: from,
        idempotent: false,
      };
    });
    if (outcome.rejected) {
      // BUY-2: rad etilgan o‘tish ham jurnalda — asosiy tranzaksiya qaytgani uchun alohida yoziladi
      await this.journal(
        this.dataSource.manager,
        orderId,
        outcome.rejected,
        to,
        false,
        actor,
        reason,
      );
      throw BusinessException.invalidState(
        `Holatni o‘zgartirib bo‘lmaydi: ${outcome.rejected} → ${to}`,
      );
    }
    return result!;
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
      `SELECT i.product_id::text AS "productId", s.shop_id::text AS "wholesalerId", i.sku,
              i.product_name AS name, i.quantity, i.weight_grams AS "weightGrams",
              i.approved_price::text AS "approvedPrice", i.base_price::text AS "basePrice",
              i.unit_price::text AS "salePrice", i.affiliate_fee::text AS "affiliateFee",
              i.call_center_fee::text AS "callCenterFee", i.hidden_delivery::text AS "hiddenDelivery",
              i.platform_service::text AS "platformService"
         FROM checkout.sales_order_item i
         JOIN checkout.sales_order_seller s ON s.id = i.sales_order_seller_id
        WHERE s.sales_order_id = $1
        ORDER BY i.id`,
      [orderId],
    )) as Array<Record<string, string | number | null>>;
    const [parcel] = (await manager.query(
      `SELECT elchi_shipment_id::text AS "shipmentId", tracking_url AS "trackingUrl"
         FROM checkout.sales_order_seller
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

/** Odamga ko‘rinadigan lid buyurtmasi raqami (shartnoma namunasi «L-1183»). */
export function leadOrderNumber(orderId: string): string {
  return `L-${orderId}`;
}
