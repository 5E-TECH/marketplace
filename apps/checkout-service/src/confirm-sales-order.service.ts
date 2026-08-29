import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { RmqClient, sendRpc } from '@app/common';
import { firstValueFrom } from 'rxjs';
import { DataSource } from 'typeorm';

interface OrderRow {
  id: string;
  customer_id: string;
  buyer_name: string | null;
  status: string;
  payment_method: string;
  total_amount: string;
  delivery_address: string | null;
  region_id: string | null;
  district_id: string | null;
  where_deliver: string;
}

interface SellerOrderRow {
  id: string;
  shop_id: string;
  subtotal: string;
  elchi_shipment_id: string | null;
}

interface ShopDetails {
  ownerUserId: string;
  elchiMarketId: string | null;
}

interface ConfirmOptions {
  customerId?: string;
  prepaid: boolean;
  paymentId?: string;
  paidAmount?: number;
}

export interface ConfirmSalesOrderResult {
  id: string;
  status: 'CONFIRMED';
  sellerOrders: Array<{
    id: string;
    elchiShipmentId: string;
    trackingUrl?: string;
  }>;
}

@Injectable()
export class ConfirmSalesOrderService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.NOTIFICATION)
    private readonly notifications: ClientProxy,
  ) {}

  async confirm(
    orderId: string,
    customerId?: string,
  ): Promise<ConfirmSalesOrderResult> {
    return this.confirmOrder(orderId, { customerId, prepaid: false });
  }

  async confirmPaid(
    orderId: string,
    paymentId: string,
    paidAmount: number,
  ): Promise<ConfirmSalesOrderResult> {
    return this.confirmOrder(orderId, {
      prepaid: true,
      paymentId,
      paidAmount,
    });
  }

  private async confirmOrder(
    orderId: string,
    options: ConfirmOptions,
  ): Promise<ConfirmSalesOrderResult> {
    const confirmed = await this.dataSource.transaction(async (manager) => {
      const [order] = (await manager.query(
        `SELECT * FROM checkout.sales_order WHERE id=$1 FOR UPDATE`,
        [orderId],
      )) as OrderRow[];
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      if (
        options.customerId &&
        String(order.customer_id) !== String(options.customerId)
      ) {
        throw new NotFoundException('Buyurtma topilmadi');
      }
      const expectedMethod = options.prepaid ? 'online' : 'cod';
      if (order.payment_method !== expectedMethod) {
        throw new BadRequestException(
          options.prepaid
            ? 'To‘lov faqat online buyurtmani tasdiqlashi mumkin'
            : 'Bu amal faqat COD buyurtma uchun',
        );
      }
      if (
        options.prepaid &&
        Number(order.total_amount) !== Number(options.paidAmount)
      ) {
        throw new BadRequestException('To‘lov summasi buyurtmaga mos emas');
      }

      const sellers = (await manager.query(
        `SELECT id::text, shop_id::text, subtotal::text,
                elchi_shipment_id::text
         FROM checkout.sales_order_seller
         WHERE sales_order_id=$1 ORDER BY id`,
        [orderId],
      )) as SellerOrderRow[];

      if (order.status === 'CONFIRMED') {
        return {
          result: this.result(orderId, sellers),
          notify: false,
          sellerUserIds: [] as string[],
          order,
        };
      }
      const expectedStatus = options.prepaid ? 'PENDING_PAYMENT' : 'DRAFT';
      if (order.status !== expectedStatus) {
        throw new BadRequestException(
          `Buyurtmani ${order.status} holatidan tasdiqlab bo‘lmaydi`,
        );
      }
      if (!sellers.length) {
        throw new BadRequestException('Sub-buyurtmalar topilmadi');
      }

      const sellerUserIds: string[] = [];
      const shipmentResults: ConfirmSalesOrderResult['sellerOrders'] = [];
      for (const seller of sellers) {
        const shop = await sendRpc<ShopDetails>(
          this.catalog,
          { cmd: 'catalog.shop.get-by-id' },
          { shopId: seller.shop_id },
        );
        if (!shop.elchiMarketId) {
          throw new BadRequestException(
            `Do‘kon ${seller.shop_id} Elchi bilan bog‘lanmagan`,
          );
        }
        sellerUserIds.push(String(shop.ownerUserId));

        const items = (await manager.query(
          `SELECT product_id::text, product_name, quantity
           FROM checkout.sales_order_item
           WHERE sales_order_seller_id=$1 ORDER BY id`,
          [seller.id],
        )) as Array<{
          product_id: string;
          product_name: string;
          quantity: number;
        }>;
        const address = this.delivery(order.delivery_address);
        const shipment = await sendRpc<{
          shipment_id: string;
          tracking_url?: string;
        }>(
          this.integration,
          { cmd: 'integration.shipment.create' },
          {
            external_order_id: seller.id,
            elchi_market_id: shop.elchiMarketId,
            customer: {
              name: order.buyer_name ?? '',
              phone: address.phone,
            },
            address: address.address,
            region_id: order.region_id,
            district_id: order.district_id,
            where_deliver: order.where_deliver,
            items: items.map((item) => ({
              name: item.product_name || `product-${item.product_id}`,
              quantity: item.quantity,
            })),
            cod_amount: options.prepaid ? 0 : Number(seller.subtotal),
          },
        );
        await manager.query(
          `UPDATE checkout.sales_order_seller
           SET elchi_shipment_id=$1, tracking_url=$2, status='SHIPMENT_CREATED', updated_at=now()
           WHERE id=$3`,
          [shipment.shipment_id, shipment.tracking_url ?? null, seller.id],
        );
        seller.elchi_shipment_id = shipment.shipment_id;
        shipmentResults.push({
          id: seller.id,
          elchiShipmentId: shipment.shipment_id,
          ...(shipment.tracking_url
            ? { trackingUrl: shipment.tracking_url }
            : {}),
        });
      }

      await sendRpc(
        this.inventory,
        { cmd: 'inventory.commit' },
        {
          orderRef: orderId,
          idempotencyKey: `confirm:${orderId}`,
          actorId: options.customerId,
        },
      );
      await manager.query(
        `UPDATE checkout.sales_order
         SET status='CONFIRMED', payment_id=COALESCE(payment_id,$2), updated_at=now()
         WHERE id=$1`,
        [orderId, options.paymentId ?? null],
      );
      return {
        result: {
          id: orderId,
          status: 'CONFIRMED' as const,
          sellerOrders: shipmentResults,
        },
        notify: true,
        sellerUserIds,
        order,
      };
    });

    if (confirmed.notify) {
      await firstValueFrom(
        this.notifications.emit('order.created', {
          orderId,
          recipients: [
            { userId: String(confirmed.order.customer_id) },
            ...confirmed.sellerUserIds.map((userId) => ({ userId })),
          ],
          totalAmount: Number(confirmed.order.total_amount),
        }),
      );
    }
    return confirmed.result;
  }

  private result(
    orderId: string,
    sellers: SellerOrderRow[],
  ): ConfirmSalesOrderResult {
    return {
      id: orderId,
      status: 'CONFIRMED',
      sellerOrders: sellers.map((seller) => ({
        id: seller.id,
        elchiShipmentId: String(seller.elchi_shipment_id),
      })),
    };
  }

  private delivery(value: string | null): { address: string; phone: string } {
    const parts = String(value ?? '').split('\n');
    const phone = parts.length > 1 ? (parts.pop() ?? '') : '';
    return { address: parts.join('\n'), phone };
  }
}
