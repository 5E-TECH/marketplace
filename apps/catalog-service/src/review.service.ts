import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import {
  CreateReviewDto,
  ReviewEligibilityDto,
  ReviewsQueryDto,
  RmqClient,
  sendRpc,
} from '@app/common';

export interface ReviewRow {
  id: string;
  userId: string;
  orderItemId: string;
  productId: string;
  shopId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
}

@Injectable()
export class ReviewService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  async create(userId: string, productId: string, dto: CreateReviewDto) {
    const eligibility = await sendRpc<ReviewEligibilityDto>(
      this.checkout,
      { cmd: 'checkout.review.verify' },
      { customerId: userId, orderItemId: dto.orderItemId, productId },
    );

    try {
      return await this.dataSource.transaction(async (manager) => {
        const [product] = await manager.query(
          `SELECT id FROM catalog.product WHERE id=$1 AND is_deleted=FALSE FOR UPDATE`,
          [productId],
        );
        if (!product) throw new NotFoundException('Mahsulot topilmadi');

        const [review] = (await manager.query(
          `INSERT INTO catalog.review
             (user_id,order_item_id,seller_order_id,product_id,shop_id,rating,comment)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           RETURNING id::text,user_id::text AS "userId",
                     order_item_id::text AS "orderItemId",
                     product_id::text AS "productId",shop_id::text AS "shopId",
                     rating,comment,created_at AS "createdAt"`,
          [
            userId,
            dto.orderItemId,
            eligibility.sellerOrderId,
            productId,
            eligibility.shopId,
            dto.rating,
            dto.comment?.trim() || null,
          ],
        )) as ReviewRow[];

        await manager.query(
          `UPDATE catalog.product p SET rating=(
             SELECT ROUND(AVG(r.rating)::numeric,2) FROM catalog.review r
              WHERE r.product_id=p.id
           ),updated_at=now() WHERE p.id=$1`,
          [productId],
        );
        await manager.query(
          `UPDATE catalog.shop s SET rating=(
             SELECT ROUND(AVG(r.rating)::numeric,2) FROM catalog.review r
              WHERE r.shop_id=s.id
           ),updated_at=now() WHERE s.id=$1`,
          [eligibility.shopId],
        );
        return review;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(
          'Bu buyurtma mahsulotiga allaqachon sharh qoldirilgan',
        );
      }
      throw error;
    }
  }

  async list(productId: string, query: ReviewsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, count] = await Promise.all([
      this.dataSource.query(
        `SELECT id::text,user_id::text AS "userId",product_id::text AS "productId",
                shop_id::text AS "shopId",rating,comment,created_at AS "createdAt"
           FROM catalog.review WHERE product_id=$1
          ORDER BY created_at DESC,id DESC OFFSET $2 LIMIT $3`,
        [productId, (page - 1) * limit, limit],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total,COALESCE(ROUND(AVG(rating)::numeric,2),0)::float8 AS rating
           FROM catalog.review WHERE product_id=$1`,
        [productId],
      ),
    ]);
    const total = Number(count[0]?.total ?? 0);
    return {
      items,
      rating: Number(count[0]?.rating ?? 0),
      total,
      page,
      limit,
      totalPages: total ? Math.ceil(total / limit) : 0,
    };
  }
}
