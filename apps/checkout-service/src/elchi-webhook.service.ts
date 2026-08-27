import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { DataSource, EntityManager } from 'typeorm';
import {
  ElchiWebhookDto,
  CheckoutPaymentMethod,
  ReturnOrderItemsDto,
  RmqClient,
  SalesOrderSellerStatus,
  sendRpc,
} from '@app/common';

interface SellerOrderWebhookRow {
  id: string;
  sales_order_id: string;
  shop_id: string;
  subtotal: string;
  payment_method: CheckoutPaymentMethod;
  elchi_shipment_id: string | null;
}

const STATUS_MAP: Record<string, SalesOrderSellerStatus> = {
  shipment_created: SalesOrderSellerStatus.SHIPMENT_CREATED,
  on_the_road: SalesOrderSellerStatus.ON_THE_ROAD,
  delivered: SalesOrderSellerStatus.DELIVERED,
  sold: SalesOrderSellerStatus.DELIVERED,
  cancelled: SalesOrderSellerStatus.CANCELLED,
  canceled: SalesOrderSellerStatus.CANCELLED,
  returned: SalesOrderSellerStatus.RETURNED,
};

@Injectable()
export class ElchiWebhookService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
  ) {}

  process(
    event: ElchiWebhookDto,
  ): Promise<{ received: true; duplicate?: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        event.eventId,
      ]);
      const duplicate = await manager.query(
        'SELECT event_id FROM checkout.elchi_webhook_event WHERE event_id=$1',
        [event.eventId],
      );
      if (duplicate.length) return { received: true, duplicate: true };

      const status = STATUS_MAP[event.status];
      if (!status)
        throw new BadRequestException('Elchi statusi qo‘llab-quvvatlanmaydi');
      const sellerOrder = await this.sellerOrder(manager, event);

      if (status === SalesOrderSellerStatus.RETURNED) {
        await this.restoreInventory(manager, sellerOrder, event);
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
      await manager.query(
        `INSERT INTO checkout.elchi_webhook_event
          (event_id,shipment_id,sales_order_seller_id,status,occurred_at,payload)
         VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          event.eventId,
          event.shipmentId,
          sellerOrder.id,
          status,
          event.occurredAt,
          JSON.stringify(event),
        ],
      );

      if (
        status === SalesOrderSellerStatus.DELIVERED &&
        sellerOrder.payment_method !== CheckoutPaymentMethod.COD
      ) {
        await firstValueFrom(
          this.finance.emit('finance.payout.requested', {
            eventId: event.eventId,
            sellerOrderId: sellerOrder.id,
            salesOrderId: sellerOrder.sales_order_id,
            shopId: sellerOrder.shop_id,
            amount: Number(sellerOrder.subtotal),
            paymentMethod: sellerOrder.payment_method,
            occurredAt: event.occurredAt,
          }),
        );
      }

      return { received: true };
    });
  }

  private async sellerOrder(
    manager: EntityManager,
    event: ElchiWebhookDto,
  ): Promise<SellerOrderWebhookRow> {
    const [row] = (await manager.query(
      `SELECT s.id::text,s.sales_order_id::text,s.shop_id::text,s.subtotal::text,
              s.elchi_shipment_id::text,o.payment_method
         FROM checkout.sales_order_seller s
         JOIN checkout.sales_order o ON o.id=s.sales_order_id
        WHERE s.id=$1
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
}
