import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ReviewEligibilityDto, SalesOrderSellerStatus } from '@app/common';

@Injectable()
export class ReviewEligibilityService {
  constructor(private readonly dataSource: DataSource) {}

  async verify(
    customerId: string,
    orderItemId: string,
    productId: string,
  ): Promise<ReviewEligibilityDto> {
    const [row] = (await this.dataSource.query(
      `SELECT i.id::text AS "orderItemId",o.customer_id::text AS "customerId",
              i.product_id::text AS "productId",s.shop_id::text AS "shopId",
              s.id::text AS "sellerOrderId",s.status
         FROM checkout.sales_order_item i
         JOIN checkout.sales_order_seller s ON s.id=i.sales_order_seller_id
         JOIN checkout.sales_order o ON o.id=s.sales_order_id
        WHERE i.id=$1`,
      [orderItemId],
    )) as ReviewEligibilityDto[];
    if (!row) throw new NotFoundException('Buyurtma mahsuloti topilmadi');
    if (row.customerId !== customerId || row.productId !== productId) {
      throw new ForbiddenException(
        'Bu mahsulot uchun sharh qoldirish mumkin emas',
      );
    }
    if (row.status !== SalesOrderSellerStatus.DELIVERED) {
      throw new ForbiddenException(
        'Faqat yetkazib berilgan mahsulotga sharh qoldirish mumkin',
      );
    }
    return row;
  }
}
