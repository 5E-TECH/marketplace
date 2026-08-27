import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ProductStatus,
  ShopStatus,
  FavoritesPageDto,
  FavoritesQueryDto,
  FavoriteOwnerDto,
} from '@app/common';
import { QueryFailedError, Repository } from 'typeorm';
import { Favorite } from './entities/favorite.entity';
import { Product } from './entities/product.entity';

@Injectable()
export class FavoriteService {
  constructor(
    @InjectRepository(Favorite)
    private readonly favorites: Repository<Favorite>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
  ) {}

  async add(owner: FavoriteOwnerDto, productId: string) {
    const where = this.ownerWhere(owner, productId);
    await this.activeProduct(productId);
    const existing = await this.favorites.findOne({ where });
    if (existing) return { productId, isFavorite: true };
    try {
      await this.favorites.save(this.favorites.create(where));
    } catch (error) {
      if (
        !(error instanceof QueryFailedError) ||
        (error.driverError as { code?: string })?.code !== '23505'
      )
        throw error;
    }
    return { productId, isFavorite: true };
  }

  async remove(owner: FavoriteOwnerDto, productId: string) {
    await this.favorites.delete(this.ownerWhere(owner, productId));
    return { productId, isFavorite: false };
  }

  async check(owner: FavoriteOwnerDto, productId: string) {
    const exists = await this.favorites.exists({
      where: this.ownerWhere(owner, productId),
    });
    return { productId, isFavorite: exists };
  }

  async list(
    owner: FavoriteOwnerDto,
    query: FavoritesQueryDto,
  ): Promise<FavoritesPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const ownerColumn = owner.userId
      ? 'favorite.user_id'
      : 'favorite.session_id';
    const ownerValue = owner.userId ?? owner.sessionId;
    if (!ownerValue)
      throw new BadRequestException('x-session-id yoki login talab qilinadi');
    const [items, total] = await this.favorites
      .createQueryBuilder('favorite')
      .innerJoinAndSelect(
        'favorite.product',
        'product',
        'product.is_deleted=FALSE AND product.status=:productStatus',
        { productStatus: ProductStatus.ACTIVE },
      )
      .innerJoinAndSelect(
        'product.shop',
        'shop',
        'shop.is_deleted=FALSE AND shop.status=:shopStatus',
        { shopStatus: ShopStatus.ACTIVE },
      )
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect(
        'product.variants',
        'variant',
        'variant.is_deleted=FALSE AND variant.is_active=TRUE',
      )
      .where(`${ownerColumn}=:ownerValue`, { ownerValue })
      .orderBy('favorite.createdAt', 'DESC')
      .addOrderBy('favorite.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    } as FavoritesPageDto;
  }

  async merge(userId: string, sessionId: string) {
    if (!userId || !sessionId)
      throw new BadRequestException('userId va sessionId majburiy');
    await this.favorites.manager.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO catalog.favorite(user_id, product_id, created_at)
         SELECT $1, product_id, created_at
           FROM catalog.favorite
          WHERE session_id=$2
         ON CONFLICT (user_id, product_id) WHERE user_id IS NOT NULL DO NOTHING`,
        [userId, sessionId],
      );
      await manager.query(`DELETE FROM catalog.favorite WHERE session_id=$1`, [
        sessionId,
      ]);
    });
    return { merged: true };
  }

  private ownerWhere(owner: FavoriteOwnerDto, productId: string) {
    if (owner.userId) {
      return { userId: owner.userId, productId };
    }
    if (owner.sessionId) {
      return { sessionId: owner.sessionId, productId };
    }
    throw new BadRequestException('x-session-id yoki login talab qilinadi');
  }

  private async activeProduct(productId: string): Promise<Product> {
    const product = await this.products
      .createQueryBuilder('product')
      .innerJoin(
        'product.shop',
        'shop',
        'shop.is_deleted=FALSE AND shop.status=:shopStatus',
        { shopStatus: ShopStatus.ACTIVE },
      )
      .where('product.id=:productId', { productId })
      .andWhere('product.is_deleted=FALSE')
      .andWhere('product.status=:productStatus', {
        productStatus: ProductStatus.ACTIVE,
      })
      .getOne();
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    return product;
  }
}
