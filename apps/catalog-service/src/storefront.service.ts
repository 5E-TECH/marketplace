import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, SelectQueryBuilder, Repository } from 'typeorm';
import {
  ProductStatus,
  ShopStatus,
  StorefrontProductsPageDto,
  StorefrontProductsQueryDto,
} from '@app/common';
import { Product } from './entities/product.entity';
import { Shop } from './entities/shop.entity';

@Injectable()
export class StorefrontService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
  ) {}

  async listProducts(
    query: StorefrontProductsQueryDto,
  ): Promise<StorefrontProductsPageDto> {
    return this.paginate(this.activeProductsQuery(), query);
  }

  async getProduct(id: string): Promise<Product> {
    const product = await this.activeProductsQuery()
      .leftJoinAndSelect(
        'product.variants',
        'variant',
        'variant.is_deleted = FALSE AND variant.is_active = TRUE',
      )
      .leftJoinAndSelect('product.category', 'category')
      .andWhere('product.id = :id', { id })
      .getOne();

    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    return product;
  }

  async getShop(slug: string, query: StorefrontProductsQueryDto) {
    const shop = await this.shops.findOne({
      where: {
        slug,
        status: ShopStatus.ACTIVE,
        isDeleted: false,
      },
    });
    if (!shop) throw new NotFoundException('Do‘kon topilmadi');

    const products = await this.paginate(
      this.activeProductsQuery().andWhere('product.shop_id = :shopId', {
        shopId: shop.id,
      }),
      query,
    );
    return { shop, products };
  }

  async getShopProducts(
    shopId: string,
    query: StorefrontProductsQueryDto,
  ): Promise<StorefrontProductsPageDto> {
    const shop = await this.shops.findOne({
      where: {
        id: shopId,
        status: ShopStatus.ACTIVE,
        isDeleted: false,
      },
    });
    if (!shop) throw new NotFoundException('Do‘kon topilmadi');

    return this.paginate(
      this.activeProductsQuery().andWhere('product.shop_id = :shopId', {
        shopId,
      }),
      query,
    );
  }

  private activeProductsQuery(): SelectQueryBuilder<Product> {
    return this.products
      .createQueryBuilder('product')
      .innerJoinAndSelect(
        'product.shop',
        'shop',
        'shop.is_deleted = FALSE AND shop.status = :shopStatus',
        { shopStatus: ShopStatus.ACTIVE },
      )
      .where('product.is_deleted = FALSE')
      .andWhere('product.status = :productStatus', {
        productStatus: ProductStatus.ACTIVE,
      });
  }

  private async paginate(
    qb: SelectQueryBuilder<Product>,
    query: StorefrontProductsQueryDto,
  ): Promise<StorefrontProductsPageDto> {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new BadRequestException(
        'minPrice maxPrice dan katta bo‘la olmaydi',
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    if (query.categoryId) {
      qb.andWhere('product.category_id = :categoryId', {
        categoryId: query.categoryId,
      });
    }
    if (query.minPrice !== undefined) {
      qb.andWhere('product.price >= :minPrice', { minPrice: query.minPrice });
    }
    if (query.maxPrice !== undefined) {
      qb.andWhere('product.price <= :maxPrice', { maxPrice: query.maxPrice });
    }
    if (query.search?.trim()) {
      qb.andWhere(
        new Brackets((search) => {
          search
            .where('product.name ILIKE :search')
            .orWhere('product.description ILIKE :search');
        }),
      ).setParameter('search', `%${query.search.trim()}%`);
    }

    const [field, direction] = (query.sort ?? 'createdAt:desc').split(':') as [
      'createdAt' | 'price' | 'name',
      'asc' | 'desc',
    ];
    const columns = {
      createdAt: 'product.created_at',
      price: 'product.price',
      name: 'product.name',
    } as const;
    const [items, total] = await qb
      .orderBy(columns[field], direction.toUpperCase() as 'ASC' | 'DESC')
      .addOrderBy('product.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }
}
