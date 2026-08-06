import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CheckoutPaymentMethod,
  CheckoutResultDto,
  CreateCheckoutDto,
  RmqClient,
  sendRpc,
} from '@app/common';
import { DataSource, EntityManager } from 'typeorm';
import { Cart } from './entities/cart.entity';

const RESERVATION_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class CheckoutService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(RmqClient.INVENTORY)
    private readonly inventory: ClientProxy,
  ) {}

  async create(
    customerId: string,
    dto: CreateCheckoutDto,
    idempotencyKey?: string,
  ): Promise<CheckoutResultDto> {
    if (!customerId) throw new BadRequestException('Login talab qilinadi');
    return this.dataSource.transaction(async (manager) => {
      const cart = await manager.getRepository(Cart).findOne({
        where: { customerId, status: 'active' },
        relations: { items: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!cart) throw new NotFoundException('Faol savat topilmadi');
      if (!cart.items.length) throw new BadRequestException('Savat bo‘sh');

      const status =
        dto.paymentMethod === CheckoutPaymentMethod.ONLINE
          ? 'pending_payment'
          : 'draft';
      const total = cart.items.reduce(
        (sum, item) => sum + Number(item.unitPriceSnapshot) * item.quantity,
        0,
      );
      const order = await this.insertOrder(
        manager,
        customerId,
        dto,
        status,
        total,
      );
      const sellerOrders = [] as CheckoutResultDto['sellerOrders'];
      const groups = new Map<string, typeof cart.items>();
      for (const item of cart.items) {
        groups.set(item.shopId, [...(groups.get(item.shopId) ?? []), item]);
      }
      for (const [shopId, items] of groups) {
        const subtotal = items.reduce(
          (sum, item) => sum + Number(item.unitPriceSnapshot) * item.quantity,
          0,
        );
        const seller = await this.insertSellerOrder(
          manager,
          order.id,
          shopId,
          subtotal,
          dto.paymentMethod,
        );
        for (const item of items) {
          await manager.query(
            `INSERT INTO checkout.sales_order_item
             (sales_order_seller_id, product_id, product_name, variant_id, quantity, unit_price, line_total)
             VALUES ($1,$2,'',$3,$4,$5,$6)`,
            [
              seller.id,
              item.productId,
              item.variantId,
              item.quantity,
              Number(item.unitPriceSnapshot),
              Number(item.unitPriceSnapshot) * item.quantity,
            ],
          );
        }
        sellerOrders.push({
          id: seller.id,
          shopId,
          subtotal,
          status: 'pending',
        });
      }

      // RPC xatosi transactionni rollback qiladi: qoldiq yetmasa orderlar qolmaydi.
      const reservation = await sendRpc<{ reservationId: string }>(
        this.inventory,
        { cmd: 'inventory.reserve' },
        {
          orderRef: order.id,
          items: cart.items.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          })),
          ttlMs: RESERVATION_TTL_MS,
          idempotencyKey: idempotencyKey || `checkout:${order.id}`,
        },
      );
      await manager.query(
        `UPDATE checkout.sales_order SET reservation_id=$1 WHERE id=$2`,
        [reservation.reservationId, order.id],
      );
      cart.status = 'converted';
      await manager.getRepository(Cart).save(cart);

      return {
        id: order.id,
        status,
        paymentMethod: dto.paymentMethod,
        totalAmount: total,
        reservationId: reservation.reservationId,
        reservationExpiresAt: new Date(
          Date.now() + RESERVATION_TTL_MS,
        ).toISOString(),
        sellerOrders,
      };
    });
  }

  private async insertOrder(
    manager: EntityManager,
    customerId: string,
    dto: CreateCheckoutDto,
    status: string,
    total: number,
  ) {
    const [order] = await manager.query(
      `INSERT INTO checkout.sales_order
       (customer_id,buyer_name,status,payment_method,total_amount,delivery_address,region_id,district_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`,
      [
        customerId,
        dto.address.recipientName,
        status,
        dto.paymentMethod,
        total,
        `${dto.address.address}\n${dto.address.phone}`,
        dto.address.regionId || null,
        dto.address.districtId || null,
      ],
    );
    return order as { id: string };
  }

  private async insertSellerOrder(
    manager: EntityManager,
    orderId: string,
    shopId: string,
    subtotal: number,
    paymentMethod: CheckoutPaymentMethod,
  ) {
    const [seller] = await manager.query(
      `INSERT INTO checkout.sales_order_seller
       (sales_order_id,shop_id,subtotal,cod_amount,status)
       VALUES ($1,$2,$3,$4,'pending') RETURNING id::text`,
      [
        orderId,
        shopId,
        subtotal,
        paymentMethod === CheckoutPaymentMethod.COD ? subtotal : 0,
      ],
    );
    return seller as { id: string };
  }
}
