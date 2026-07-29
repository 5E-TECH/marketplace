import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, QueryFailedError, Repository } from 'typeorm';
import {
  CreateProductDto,
  MyProductsPageDto,
  MyProductsQueryDto,
  ProductStatus,
  UpdateProductDto,
} from '@app/common';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { Shop } from './entities/shop.entity';
import { ProductVariant } from './entities/product-variant.entity';

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
  ) {}

  async create(ownerUserId: string, dto: CreateProductDto): Promise<Product> {
    const shop = await this.getShop(ownerUserId);
    await this.ensureCategoryExists(dto.categoryId);
    const slug = await this.uniqueSlug(shop.id, dto.name);

    const product = this.products.create({
      shopId: shop.id,
      ownerUserId,
      categoryId: dto.categoryId ?? null,
      name: dto.name.trim(),
      slug,
      description: dto.description ?? null,
      price: dto.price,
      oldPrice: dto.oldPrice ?? null,
      imageUrl: dto.imageUrl ?? null,
      images: dto.images ?? [],
      attributes: dto.attributes ?? {},
      hasVariants: false,
      status: dto.status ?? ProductStatus.DRAFT,
    });
    const createdProduct = await this.save(product);
    const defaultVariant = this.variants.create({
      productId: createdProduct.id,
      sku: `PRODUCT-${createdProduct.id}-DEFAULT`,
      name: 'Default',
      attributes: {},
      price: null,
      oldPrice: null,
      barcode: null,
      imageUrl: null,
      isActive: true,
    });
    await this.variants.save(defaultVariant);
    return createdProduct;
  }

  async getMine(
    ownerUserId: string,
    query: MyProductsQueryDto,
  ): Promise<MyProductsPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.products
      .createQueryBuilder('product')
      .where('product.owner_user_id = :ownerUserId', { ownerUserId })
      .andWhere('product.is_deleted = FALSE');

    if (query.status) {
      qb.andWhere('product.status = :status', { status: query.status });
    }
    if (query.categoryId) {
      qb.andWhere('product.category_id = :categoryId', {
        categoryId: query.categoryId,
      });
    }
    if (query.search?.trim()) {
      qb.andWhere(
        new Brackets((search) => {
          search
            .where('product.name ILIKE :search')
            .orWhere('product.slug ILIKE :search');
        }),
      ).setParameter('search', `%${query.search.trim()}%`);
    }

    const [items, total] = await qb
      .orderBy('product.created_at', 'DESC')
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

  async getOne(ownerUserId: string, id: string): Promise<Product> {
    return this.getOwned(ownerUserId, id);
  }

  async addImage(
    ownerUserId: string,
    id: string,
    url: string,
    isCover: boolean,
  ): Promise<Product> {
    const product = await this.getOwned(ownerUserId, id);
    if (!product.images.includes(url)) {
      product.images = [...product.images, url];
    }
    if (isCover) {
      product.imageUrl = url;
    }
    return this.save(product);
  }

  async update(
    ownerUserId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<Product> {
    const product = await this.getOwned(ownerUserId, id);
    await this.ensureCategoryExists(dto.categoryId);

    if (dto.name !== undefined) {
      product.name = dto.name.trim();
      product.slug = await this.uniqueSlug(
        product.shopId,
        dto.name,
        product.id,
      );
    }
    if (dto.categoryId !== undefined) product.categoryId = dto.categoryId;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.price !== undefined) product.price = dto.price;
    if (dto.oldPrice !== undefined) product.oldPrice = dto.oldPrice;
    if (dto.imageUrl !== undefined) product.imageUrl = dto.imageUrl;
    if (dto.images !== undefined) product.images = dto.images;
    if (dto.attributes !== undefined) product.attributes = dto.attributes;
    if (dto.status !== undefined) product.status = dto.status;

    return this.save(product);
  }

  async remove(
    ownerUserId: string,
    id: string,
  ): Promise<{ id: string; deleted: true }> {
    const product = await this.getOwned(ownerUserId, id);
    product.isDeleted = true;
    await this.products.save(product);
    return { id, deleted: true };
  }

  private async getShop(ownerUserId: string): Promise<Shop> {
    const shop = await this.shops.findOne({
      where: { ownerUserId, isDeleted: false },
    });
    if (!shop) throw new NotFoundException('Sotuvchining do‘koni topilmadi');
    return shop;
  }

  private async getOwned(ownerUserId: string, id: string): Promise<Product> {
    const product = await this.products.findOne({
      where: { id, isDeleted: false },
    });
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    if (product.ownerUserId !== ownerUserId) {
      throw new ForbiddenException(
        'Boshqa sotuvchining mahsulotini boshqarish mumkin emas',
      );
    }
    return product;
  }

  private async ensureCategoryExists(
    categoryId?: string | null,
  ): Promise<void> {
    if (categoryId == null) return;
    const category = await this.categories.findOne({
      where: { id: categoryId, isDeleted: false, isActive: true },
    });
    if (!category) throw new NotFoundException('Kategoriya topilmadi');
  }

  private async uniqueSlug(
    shopId: string,
    name: string,
    ignoredId?: string,
  ): Promise<string> {
    const base = this.toSlug(name);
    let slug = base;
    let suffix = 2;
    while (true) {
      const existing = await this.products.findOne({
        where: { shopId, slug },
      });
      if (!existing || existing.id === ignoredId) return slug;
      slug = `${base}-${suffix++}`;
    }
  }

  private toSlug(name: string): string {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[ʻʼ’‘`]/g, "'")
      .replace(/o'/g, 'o')
      .replace(/g'/g, 'g')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) throw new ConflictException('Yaroqli slug hosil qilib bo‘lmadi');
    return slug;
  }

  private async save(product: Product): Promise<Product> {
    try {
      return await this.products.save(product);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === '23505'
      ) {
        throw new ConflictException('Bunday slug bilan mahsulot mavjud');
      }
      throw error;
    }
  }
}
