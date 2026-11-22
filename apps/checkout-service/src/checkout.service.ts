import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Eski onlayn to‘lov konteksti (payment-service). Savat va eski checkout BE-29 da o‘chirildi. */
@Injectable()
export class CheckoutService {
  constructor(private readonly dataSource: DataSource) {}

  async paymentContext(
    orderId: string,
    customerId: string,
  ): Promise<{ amount: number }> {
    if (
      !customerId ||
      !/^[1-9]\d{0,18}$/.test(orderId) ||
      BigInt(orderId) > BigInt('9223372036854775807')
    )
      throw new NotFoundException('Buyurtma topilmadi');
    const [order] = await this.dataSource.query(
      `SELECT total_amount, status, payment_method FROM checkout.sales_order WHERE id=$1 AND customer_id=$2`,
      [orderId, customerId],
    );
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.payment_method !== 'online' || order.status !== 'PENDING_PAYMENT')
      throw new BadRequestException(
        'Buyurtma online to‘lov kutayotgan holatda emas',
      );
    return { amount: Number(order.total_amount) };
  }
}
