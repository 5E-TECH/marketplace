import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { DataSource, EntityManager } from 'typeorm';
import {
  ElchiWebhookDto,
  CheckoutPaymentMethod,
  OutboxService,
  ReturnOrderItemsDto,
  RefundPaymentDto,
  RmqClient,
  SalesOrderSellerStatus,
  sendRpc,
} from '@app/common';
import {
  ElchiLeadWebhookService,
  ElchiWebhookOutcome,
  ElchiWebhookResult,
} from './elchi-lead-webhook.service';

interface SellerOrderWebhookRow {
  id: string;
  sales_order_id: string;
  shop_id: string;
  subtotal: string;
  status: SalesOrderSellerStatus;
  payment_method: CheckoutPaymentMethod;
  payment_id: string | null;
  elchi_shipment_id: string | null;
}

const STATUS_MAP: Record<string, SalesOrderSellerStatus> = {
  shipment_created: SalesOrderSellerStatus.SHIPMENT_CREATED,
  received: SalesOrderSellerStatus.RECEIVED,
  on_the_road: SalesOrderSellerStatus.ON_THE_ROAD,
  delivered: SalesOrderSellerStatus.DELIVERED,
  sold: SalesOrderSellerStatus.DELIVERED,
  cancelled: SalesOrderSellerStatus.CANCELLED,
  canceled: SalesOrderSellerStatus.CANCELLED,
  returned: SalesOrderSellerStatus.RETURNED,
  settled: SalesOrderSellerStatus.DELIVERED,
  // BE-21 (T9-7): Elchi `paid` — eski yo‘lda «settled» (COD hisob-kitobi, 1-versiya)
  paid: SalesOrderSellerStatus.DELIVERED,
};

/** Eski yo‘l: yo‘ldagi holatlar tartibi (BE-21, T9-6 «faqat oldinga»). */
const LEGACY_RANK: Partial<Record<SalesOrderSellerStatus, number>> = {
  [SalesOrderSellerStatus.PENDING]: 0,
  [SalesOrderSellerStatus.CONFIRMED]: 0,
  [SalesOrderSellerStatus.SHIPMENT_CREATED]: 1,
  [SalesOrderSellerStatus.RECEIVED]: 2,
  [SalesOrderSellerStatus.ON_THE_ROAD]: 3,
  [SalesOrderSellerStatus.DELIVERED]: 4,
};

/**
 * Eski yo‘l: holat faqat oldinga; yakuniy holatdan faqat qaytarish — «yetkazildi → qaytarildi» va «bekor →
 * qaytarildi» (Elchi ketma-ketligi: cancelled → cancelled (sent) → returned_to_market — tovar omborga qaytadi).
 */
export function legacyTransitionAllowed(
  from: SalesOrderSellerStatus,
  to: SalesOrderSellerStatus,
): boolean {
  if (from === SalesOrderSellerStatus.RETURNED) return false;
  if (
    from === SalesOrderSellerStatus.DELIVERED ||
    from === SalesOrderSellerStatus.CANCELLED
  )
    return to === SalesOrderSellerStatus.RETURNED;
  if (
    to === SalesOrderSellerStatus.CANCELLED ||
    to === SalesOrderSellerStatus.RETURNED
  )
    return true;
  return (LEGACY_RANK[to] ?? 0) > (LEGACY_RANK[from] ?? 0);
}

@Injectable()
export class ElchiWebhookService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    @Inject(RmqClient.PAYMENT) private readonly payment: ClientProxy,
    // BE-03: moliya hodisalari outbox orqali — webhook tranzaksiyasi rollback
    // bo'lsa (masalan, keyingi qadam xato bersa) hodisa ketmaydi.
    private readonly outbox: OutboxService,
    // BE-21: lid buyurtmasi (`mp-order:<id>`) — T5 bo‘yicha alohida yo‘l
    private readonly leadWebhook: ElchiLeadWebhookService,
  ) {}

  process(event: ElchiWebhookDto): Promise<ElchiWebhookOutcome> {
    if (this.leadWebhook.orderIdOf(event))
      return this.leadWebhook.process(event);
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        event.eventId,
      ]);
      const duplicate = await manager.query(
        'SELECT event_id FROM checkout.elchi_webhook_event WHERE event_id=$1',
        [event.eventId],
      );
      if (duplicate.length) return { received: true, duplicate: true };

      // BE-21: eski yo‘lda qisman to‘lov va «yopildi» holatga ta’sir qilmaydi — faqat jurnal
      if (event.status === 'partly_paid' || event.status === 'closed') {
        const sellerOrder = await this.sellerOrder(manager, event);
        await this.journal(
          manager,
          event,
          sellerOrder.id,
          'IGNORED',
          'eski yo‘l: holatga ta’siri yo‘q',
        );
        return { received: true, result: 'IGNORED' };
      }

      const status = STATUS_MAP[event.status];
      if (!status)
        throw new BadRequestException('Elchi statusi qo‘llab-quvvatlanmaydi');
      const sellerOrder = await this.sellerOrder(manager, event);

      const settle = event.status === 'settled' || event.status === 'paid';
      const codCollected = event.codCollected ?? event.collectedFromCustomer;
      if (settle && codCollected === undefined) {
        throw new BadRequestException('settled event uchun codCollected kerak');
      }
      // BE-21 (T9-6): takroriy holat — yon ta’sirsiz (qaytarishda qoldiq ikki marta qaytmasin); orqaga — rad
      if (sellerOrder.status === status && !settle) {
        await this.journal(manager, event, sellerOrder.id, 'NOOP', null);
        return { received: true, result: 'NOOP' };
      }
      if (
        sellerOrder.status !== status &&
        !legacyTransitionAllowed(sellerOrder.status, status)
      ) {
        await this.journal(
          manager,
          event,
          sellerOrder.id,
          'REJECTED',
          `${sellerOrder.status} → ${status}: faqat oldinga`,
        );
        return { received: true, result: 'REJECTED' };
      }

      if (status === SalesOrderSellerStatus.RETURNED) {
        await this.restoreInventory(manager, sellerOrder, event);
        // bekor qilinganda pul allaqachon qaytarilgan — qaytarishda faqat qoldiq
        if (
          sellerOrder.payment_method !== CheckoutPaymentMethod.COD &&
          sellerOrder.status !== SalesOrderSellerStatus.CANCELLED
        ) {
          await this.refundOnlinePayment(manager, sellerOrder, event, true);
        }
      } else if (
        status === SalesOrderSellerStatus.CANCELLED &&
        sellerOrder.payment_method !== CheckoutPaymentMethod.COD
      ) {
        await this.refundOnlinePayment(manager, sellerOrder, event, false);
      }

      await manager.query(
        `UPDATE checkout.sales_order_seller
            SET status=$1, updated_at=now()
          WHERE id=$2`,
        [status, sellerOrder.id],
      );
      await manager.query(
        `INSERT INTO checkout.sales_order_seller_history
          (sales_order_seller_id,status,comment)
         VALUES($1,$2,$3)`,
        [sellerOrder.id, status, `Elchi webhook: ${event.eventId}`],
      );
      await this.journal(manager, event, sellerOrder.id, 'APPLIED', null);

      if (
        status === SalesOrderSellerStatus.DELIVERED &&
        sellerOrder.status !== SalesOrderSellerStatus.DELIVERED &&
        sellerOrder.payment_method !== CheckoutPaymentMethod.COD
      ) {
        await this.financeEvent(
          manager,
          sellerOrder,
          'finance.payout.requested',
          {
            eventId: event.eventId,
            sellerOrderId: sellerOrder.id,
            salesOrderId: sellerOrder.sales_order_id,
            shopId: sellerOrder.shop_id,
            amount: Number(sellerOrder.subtotal),
            paymentMethod: sellerOrder.payment_method,
            occurredAt: event.occurredAt,
          },
        );
      }
      if (settle && sellerOrder.payment_method === CheckoutPaymentMethod.COD) {
        await this.financeEvent(manager, sellerOrder, 'finance.cod.settled', {
          eventId: event.eventId,
          sellerOrderId: sellerOrder.id,
          salesOrderId: sellerOrder.sales_order_id,
          shopId: sellerOrder.shop_id,
          expectedAmount: Number(sellerOrder.subtotal),
          collectedAmount: Number(codCollected),
          occurredAt: event.occurredAt,
        });
      }

      return { received: true, result: 'APPLIED' };
    });
  }

  /** BE-21 (ELC-3): har webhook jurnalda — natijasi bilan. */
  private async journal(
    manager: EntityManager,
    event: ElchiWebhookDto,
    sellerOrderId: string,
    result: ElchiWebhookResult,
    detail: string | null,
  ): Promise<void> {
    // eski yo‘l jurnali holatni marketplace nomi bilan saqlaydi (admin filtri — SalesOrderSellerStatus)
    const status = STATUS_MAP[event.status] ?? event.status;
    await manager.query(
      `INSERT INTO checkout.elchi_webhook_event
        (event_id,shipment_id,sales_order_seller_id,status,occurred_at,payload,result,detail)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        event.eventId,
        event.shipmentId,
        sellerOrderId,
        status,
        event.occurredAt,
        JSON.stringify(event),
        result,
        detail,
      ],
    );
  }

  private async sellerOrder(
    manager: EntityManager,
    event: ElchiWebhookDto,
  ): Promise<SellerOrderWebhookRow> {
    const [row] = (await manager.query(
      `SELECT s.id::text,s.sales_order_id::text,s.shop_id::text,s.subtotal::text,
              s.status,s.elchi_shipment_id::text,o.payment_method,o.payment_id::text
         FROM checkout.sales_order_seller s
         JOIN checkout.sales_order o ON o.id=s.sales_order_id
        WHERE s.id=$1 AND o.source IS NULL
        FOR UPDATE OF s`,
      [event.externalOrderId],
    )) as SellerOrderWebhookRow[];
    if (!row) throw new NotFoundException('Webhook buyurtmasi topilmadi');
    if (row.elchi_shipment_id !== String(event.shipmentId)) {
      throw new BadRequestException('shipmentId buyurtmaga mos emas');
    }
    return row;
  }

  private async restoreInventory(
    manager: EntityManager,
    sellerOrder: SellerOrderWebhookRow,
    event: ElchiWebhookDto,
  ): Promise<void> {
    const items = (await manager.query(
      `SELECT variant_id::text AS "variantId", SUM(quantity)::int AS quantity
         FROM checkout.sales_order_item
        WHERE sales_order_seller_id=$1
        GROUP BY variant_id`,
      [sellerOrder.id],
    )) as ReturnOrderItemsDto['items'];
    await sendRpc(this.inventory, { cmd: 'inventory.return-order-items' }, {
      orderRef: sellerOrder.sales_order_id,
      items,
      reason: `Elchi returned: ${event.eventId}`,
      idempotencyKey: `elchi-return:${event.eventId}`,
    } satisfies ReturnOrderItemsDto);
  }

  /** Moliya hodisasini webhook tranzaksiyasi ichida outbox ga yozadi. */
  private async financeEvent(
    manager: EntityManager,
    sellerOrder: SellerOrderWebhookRow,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.outbox.record(
      {
        aggregateType: 'sales_order_seller',
        aggregateId: sellerOrder.id,
        eventType,
        payload,
      },
      manager,
    );
  }

  private async refundOnlinePayment(
    manager: EntityManager,
    sellerOrder: SellerOrderWebhookRow,
    event: ElchiWebhookDto,
    reverseLedger: boolean,
  ): Promise<void> {
    await sendRpc(this.payment, { cmd: 'payment.refund' }, {
      paymentId: sellerOrder.payment_id ?? undefined,
      salesOrderId: sellerOrder.sales_order_id,
      sellerOrderId: sellerOrder.id,
      reason: `Elchi returned: ${event.eventId}`,
      idempotencyKey: `elchi-refund:${event.eventId}`,
    } satisfies RefundPaymentDto);
    if (reverseLedger) {
      await this.financeEvent(
        manager,
        sellerOrder,
        'finance.refund.requested',
        {
          eventId: event.eventId,
          sellerOrderId: sellerOrder.id,
          shopId: sellerOrder.shop_id,
          occurredAt: event.occurredAt,
        },
      );
    }
  }
}
