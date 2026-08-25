import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ProductStatus,
  ShopStatus,
  FavoritesPageDto,
  FavoritesQueryDto,
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

  async add(userId: string, productId: string) {
    await this.activeProduct(productId);
    const existing = await this.favorites.findOne({
      where: { userId, productId },
    });
    if (existing) return { productId, isFavorite: true };
    try {
      await this.favorites.save(this.favorites.create({ userId, productId }));
    } catch (error) {
      if (
        !(error instanceof QueryFailedError) ||
        (error.driverError as { code?: string })?.code !== '23505'
      )
        throw error;
    }
    return { productId, isFavorite: true };
  }

  async remove(userId: string, productId: string) {
    await this.favorites.delete({ userId, productId });
    return { productId, isFavorite: false };
  }

  async check(userId: string, productId: string) {
    const exists = await this.favorites.exists({
      where: { userId, productId },
    });
    return { productId, isFavorite: exists };
  }

  async list(
    userId: string,
    query: FavoritesQueryDto,
  ): Promise<FavoritesPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
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
      .where('favorite.user_id=:userId', { userId })
      .orderBy('favorite.created_at', 'DESC')
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
