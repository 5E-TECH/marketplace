import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { Brackets, QueryFailedError, Repository } from 'typeorm';
import {
  AdminCreateProductDto,
  AdminUpdateProductDto,
  CreateProductDto,
  AdminProductsQueryDto,
  CatalogProductChangedEvent,
  MyProductsPageDto,
  MyProductsQueryDto,
  ProductStatus,
  RmqClient,
  ShopStatus,
  UpdateProductDto,
} from '@app/common';
import { Category } from './entities/category.entity';
import { loadCategoryFlags } from './category-flags';
import { Product } from './entities/product.entity';
import { Shop } from './entities/shop.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { hasContract } from './wholesaler.service';

/** Admin ro‘yxati va kartasi: mahsulot va toifa belgilari (BE-25). */
export type AdminProduct = Product & {
  expiryTracked: boolean;
  badByCategory: boolean;
};

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    @Inject(RmqClient.SEARCH) private readonly search: ClientProxy,
    @Inject(RmqClient.NOTIFICATION)
    private readonly notifications: ClientProxy,
  ) {}

  async create(ownerUserId: string, dto: CreateProductDto): Promise<Product> {
    const shop = await this.getShop(ownerUserId);
    return this.createForShop(shop, dto);
  }

  /** BE-07: admin optovik nomidan mahsulot qo‘shadi (FE-25); holat — PENDING_REVIEW. */
  async adminCreate(
    wholesalerId: string,
    dto: AdminCreateProductDto,
  ): Promise<Product> {
    const shop = await this.getShopById(wholesalerId);
    return this.createForShop(shop, dto, {
      cpaEnabled: dto.cpaEnabled,
      isBad: dto.isBad,
      mxikCode: dto.mxikCode,
      packageCode: dto.packageCode,
    });
  }

  private async createForShop(
    shop: Shop,
    dto: CreateProductDto,
    flags: {
      cpaEnabled?: boolean;
      isBad?: boolean;
      mxikCode?: string | null;
      packageCode?: string | null;
    } = {},
  ): Promise<Product> {
    // OPT-1: shartnomasiz mahsulot qo‘shib bo‘lmaydi
    if (!hasContract(shop))
      throw new ConflictException(
        'Optovik shartnomasi kiritilmagan — mahsulot qo‘shib bo‘lmaydi',
      );
    this.assertPhysical(dto);
    await this.ensureCategoryExists(dto.categoryId);
    const slug = await this.uniqueSlug(dto.name);
    // Validate that at least one image (imageUrl or images) is provided
    const primaryImage = dto.imageUrl?.trim();
    const galleryImages = (dto.images ?? [])
      .map((image) => image.trim())
      .filter(Boolean);
    if (!primaryImage && galleryImages.length === 0) {
      throw new BadRequestException(
        'Mahsulot yaratish uchun kamida bitta rasm majburiy',
      );
    }
    // Ensure both fields are populated for consistency
    const imageUrl = primaryImage ?? galleryImages[0];
    const images = galleryImages.length > 0 ? galleryImages : [imageUrl];

    const product = this.products.create({
      shopId: shop.id,
      ownerUserId: shop.ownerUserId,
      categoryId: dto.categoryId ?? null,
      name: dto.name.trim(),
      slug,
      description: dto.description ?? null,
      price: dto.price ?? dto.basePrice,
      oldPrice: dto.oldPrice ?? null,
      imageUrl,
      images,
      attributes: dto.attributes ?? {},
      hasVariants: false,
      // BE-07 (OPT-2, ADM-1): admin tasdiqlamaguncha sotuvga chiqmaydi
      status: ProductStatus.PENDING_REVIEW,
      moderationNote: null,
      basePrice: dto.basePrice,
      affiliateFee: dto.affiliateFee ?? null,
      weightGrams: dto.weightGrams,
      lengthMm: dto.lengthMm,
      widthMm: dto.widthMm,
      heightMm: dto.heightMm,
      cpaEnabled: flags.cpaEnabled ?? true,
      isBad: flags.isBad ?? false,
      mxikCode: flags.mxikCode ?? null,
      packageCode: flags.packageCode ?? null,
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
    await this.publishChanged(createdProduct, shop);
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
    const updated = await this.save(product);
    const shop = await this.shops.findOne({ where: { id: product.shopId } });
    if (shop) await this.publishChanged(updated, shop);
    return updated;
  }

  async update(
    ownerUserId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<Product> {
    const product = await this.getOwned(ownerUserId, id);
    await this.applyChanges(product, dto);
    const updated = await this.save(product);
    const shop = await this.shops.findOne({ where: { id: product.shopId } });
    if (shop) await this.publishChanged(updated, shop);
    return updated;
  }

  async remove(
    ownerUserId: string,
    id: string,
  ): Promise<{ id: string; deleted: true }> {
    const product = await this.getOwned(ownerUserId, id);
    product.isDeleted = true;
    await this.products.save(product);
    await this.publishRemoved(product);
    return { id, deleted: true };
  }

  async adminList(query: AdminProductsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.products
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.shop', 'shop')
      .where('product.is_deleted = FALSE');
    if (query.status) {
      qb.andWhere('product.status = :status', { status: query.status });
    }
    if (query.blocked !== undefined) {
      qb.andWhere('product.is_blocked = :blocked', { blocked: query.blocked });
      // BE-25 (FE-25): arxivdagi mahsulot «To‘xtatilgan» da chiqmaydi — faqat `status=ARCHIVED` bilan
      if (!query.status)
        qb.andWhere('product.status <> :archived', {
          archived: ProductStatus.ARCHIVED,
        });
    }
    if (query.shopId) {
      qb.andWhere('product.shop_id = :shopId', { shopId: query.shopId });
    }
    if (query.search?.trim()) {
      qb.andWhere('product.name ILIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }
    const [items, total] = await qb
      .orderBy('product.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      items: await this.withCategoryFlags(items),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async adminGet(id: string): Promise<AdminProduct> {
    const [product] = await this.withCategoryFlags([
      await this.getAdminProduct(id),
    ]);
    return product;
  }

  /**
   * BE-25 (FE-12, FE-16): toifa belgilari (ota toifadan meros) — «muddat kuzatiladi» (OMB-3: BAD yoki toifa) va toifasi
   * BAD ekani (TZ 8: mahsulotning o‘z belgisidan tashqari ham «Dori vositasi emas» chiqadi).
   */
  private async withCategoryFlags(
    products: Product[],
  ): Promise<AdminProduct[]> {
    if (!products.length) return [];
    const flags = await loadCategoryFlags(this.products.manager);
    return products.map((product) => {
      const { isBad, expiryTracked } = flags(product.categoryId);
      return Object.assign(product, {
        expiryTracked: product.isBad || expiryTracked,
        badByCategory: isBad,
      });
    });
  }

  /** BE-07: admin tahriri — CPA maydonlari, BAD va CPA belgilari (ADM-1). Holat faqat tasdiq/rad orqali. */
  async adminUpdate(id: string, dto: AdminUpdateProductDto): Promise<Product> {
    const product = await this.getAdminProduct(id);
    await this.applyChanges(product, dto);
    const cpaTurnedOn = dto.cpaEnabled === true && !product.cpaEnabled;
    if (dto.cpaEnabled !== undefined && dto.cpaEnabled !== product.cpaEnabled) {
      if (dto.cpaEnabled) await this.assertSingleActiveVariant(product.id);
      product.cpaEnabled = dto.cpaEnabled;
    }
    if (dto.isBad !== undefined) product.isBad = dto.isBad;
    if (dto.mxikCode !== undefined) product.mxikCode = dto.mxikCode ?? null;
    if (dto.packageCode !== undefined)
      product.packageCode = dto.packageCode ?? null;
    // BE-41: sotuvdagi CPA mahsulotidan kodni olib tashlab yoki kodsiz CPA ni yoqib bo‘lmaydi — chek qatori buziladi
    if (product.status === ProductStatus.ACTIVE) {
      assertFiscalCodes(product);
      if (cpaTurnedOn && !(await this.shopTin(product.shopId)))
        throw new ConflictException(
          'Optovik STIR i kiritilmagan — CPA ni yoqib bo‘lmaydi (fiskal chek)',
        );
    }
    const saved = await this.save(product);
    await this.publish(saved);
    return saved;
  }

  /** BE-07 (OPT-2, ADM-1): admin tasdig‘i — mahsulot sotuvga chiqadi. */
  async adminApprove(id: string): Promise<Product> {
    const product = await this.getAdminProduct(id);
    if (product.status === ProductStatus.ACTIVE)
      throw new ConflictException('Mahsulot allaqachon tasdiqlangan');
    if (
      ![
        ProductStatus.PENDING_REVIEW,
        ProductStatus.REJECTED,
        ProductStatus.DRAFT,
      ].includes(product.status)
    )
      throw new ConflictException(
        `${product.status} holatidagi mahsulotni tasdiqlab bo‘lmaydi`,
      );
    // Eski (BE-07 dan oldingi) mahsulotda og‘irlik, o‘lcham yoki bazaviy narx bo‘lmasligi mumkin
    if (
      product.basePrice === null ||
      !product.weightGrams ||
      !product.lengthMm ||
      !product.widthMm ||
      !product.heightMm
    )
      throw new BadRequestException(
        'Tasdiqdan oldin bazaviy narx, og‘irlik va o‘lchamlarni kiriting',
      );
    // OPT-1: shartnomasiz yoki to‘xtatilgan optovikning mahsuloti sotuvga chiqmaydi
    const shop = await this.getShopById(product.shopId);
    if (!hasContract(shop) || shop.status !== ShopStatus.ACTIVE)
      throw new ConflictException(
        'Optovik faol emas yoki shartnomasi kiritilmagan — tasdiqlab bo‘lmaydi',
      );
    if (product.cpaEnabled) await this.assertSingleActiveVariant(product.id);
    assertFiscalCodes(product);
    // BE-41: chekdagi komitent — optovik STIR i; eski optovikda bo‘lmasligi mumkin
    if (product.cpaEnabled && !(await this.shopTin(shop.id)))
      throw new ConflictException(
        'Optovik STIR i kiritilmagan — CPA mahsulotini tasdiqlab bo‘lmaydi (fiskal chek)',
      );
    product.status = ProductStatus.ACTIVE;
    product.moderationNote = null;
    const saved = await this.save(product);
    await this.publish(saved);
    return saved;
  }

  /** BE-07: admin rad etadi — sabab mahsulotda saqlanadi, sotuvga chiqmaydi. */
  async adminReject(id: string, reason: string): Promise<Product> {
    const product = await this.getAdminProduct(id);
    if (product.status === ProductStatus.REJECTED)
      throw new ConflictException('Mahsulot allaqachon rad etilgan');
    // BE-25 (FE-25): arxiv bir tomonlama [taklif]
    if (product.status === ProductStatus.ARCHIVED)
      throw new ConflictException('Mahsulot arxivda');
    product.status = ProductStatus.REJECTED;
    product.moderationNote = reason.trim();
    const saved = await this.save(product);
    await this.publishRemoved(saved);
    return saved;
  }

  /**
   * CPA mahsulotida aniq bitta faol variant: qoldiq, band va buyurtma shu variant orqali (BE-17, BE-18).
   */
  async assertSingleActiveVariant(productId: string): Promise<void> {
    const active = await this.variants.count({
      where: { productId, isActive: true, isDeleted: false },
    });
    if (active > 1)
      throw new BadRequestException(
        'CPA mahsulotida faqat bitta faol variant bo‘ladi',
      );
  }

  /** Umumiy maydonlar (sotuvchi va admin tahriri). Og‘irlik va o‘lchamni o‘chirib bo‘lmaydi (DTO: musbat son). */
  private async applyChanges(
    product: Product,
    dto: Partial<CreateProductDto>,
  ): Promise<void> {
    await this.ensureCategoryExists(dto.categoryId);
    if (dto.name !== undefined) {
      product.name = dto.name.trim();
      product.slug = await this.uniqueSlug(dto.name, product.id);
    }
    if (dto.categoryId !== undefined) product.categoryId = dto.categoryId;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.price === null)
      throw new BadRequestException('Narx bo‘sh bo‘lishi mumkin emas');
    if (dto.price !== undefined) product.price = dto.price;
    if (dto.oldPrice !== undefined) product.oldPrice = dto.oldPrice;
    if (dto.imageUrl !== undefined) product.imageUrl = dto.imageUrl;
    if (dto.images !== undefined) product.images = dto.images;
    if (dto.attributes !== undefined) product.attributes = dto.attributes;
    if (dto.basePrice !== undefined) product.basePrice = dto.basePrice;
    if (dto.affiliateFee !== undefined)
      product.affiliateFee = dto.affiliateFee ?? null;
    if (dto.weightGrams !== undefined) product.weightGrams = dto.weightGrams;
    if (dto.lengthMm !== undefined) product.lengthMm = dto.lengthMm;
    if (dto.widthMm !== undefined) product.widthMm = dto.widthMm;
    if (dto.heightMm !== undefined) product.heightMm = dto.heightMm;
  }

  /** Og‘irlik va o‘lchamsiz mahsulot saqlanmaydi (karta qabul mezoni; DTO dan tashqari chaqiruvlar uchun ham). */
  private assertPhysical(dto: CreateProductDto): void {
    const positive = (value: unknown) =>
      Number.isSafeInteger(value) && (value as number) > 0;
    if (
      !positive(dto.weightGrams) ||
      !positive(dto.lengthMm) ||
      !positive(dto.widthMm) ||
      !positive(dto.heightMm)
    )
      throw new BadRequestException(
        'Og‘irlik (g) va o‘lchamlar (mm) majburiy, musbat butun son',
      );
    if (!Number.isSafeInteger(dto.basePrice) || dto.basePrice < 0)
      throw new BadRequestException('Bazaviy narx majburiy');
  }

  private async publish(product: Product): Promise<void> {
    const shop = await this.shops.findOne({ where: { id: product.shopId } });
    if (shop) await this.publishChanged(product, shop);
  }

  async adminSuspend(id: string): Promise<Product> {
    const product = await this.getAdminProduct(id);
    if (product.isBlocked) {
      throw new ConflictException('Mahsulot allaqachon bloklangan');
    }
    product.isBlocked = true;
    const saved = await this.products.save(product);
    await this.publishRemoved(saved);
    return saved;
  }

  async adminHide(id: string, reason: string): Promise<Product> {
    const product = await this.getAdminProduct(id);
    if (product.isBlocked) {
      throw new ConflictException('Mahsulot allaqachon yashirilgan');
    }
    product.isBlocked = true;
    product.blockReason = reason.trim().slice(0, 500) || null;
    const saved = await this.products.save(product);
    await this.publishRemoved(saved);
    await this.emitProductHidden(saved, reason);
    return saved;
  }

  async adminReactivate(id: string): Promise<Product> {
    const product = await this.getAdminProduct(id);
    if (!product.isBlocked) {
      throw new ConflictException('Mahsulot bloklanmagan');
    }
    // BE-25 (FE-25): arxivdagi mahsulot «qayta yoqish» bilan qaytmaydi [taklif]
    if (product.status === ProductStatus.ARCHIVED)
      throw new ConflictException('Mahsulot arxivda');
    product.isBlocked = false;
    product.blockReason = null;
    const saved = await this.products.save(product);
    const shop = await this.shops.findOne({
      where: { id: saved.shopId, isDeleted: false },
    });
    if (shop) await this.publishChanged(saved, shop);
    return saved;
  }

  private async getShop(ownerUserId: string): Promise<Shop> {
    // shartnoma maydonlari `select: false` — OPT-1 tekshiruvi uchun o‘qiladi
    const shop = await this.shops
      .createQueryBuilder('shop')
      .addSelect(['shop.contractNumber', 'shop.contractDate'])
      .where('shop.owner_user_id = :ownerUserId AND shop.is_deleted = FALSE', {
        ownerUserId: String(ownerUserId),
      })
      .getOne();
    if (!shop) throw new NotFoundException('Sotuvchining do‘koni topilmadi');
    return shop;
  }

  /** BE-41: optovik STIR i (`select: false`) — faqat tekshiruv uchun, shop obyektiga yuklanmaydi (hodisalarga chiqmasin). */
  private async shopTin(shopId: string): Promise<string | null> {
    const row = await this.shops
      .createQueryBuilder('shop')
      .select('shop.id')
      .addSelect('shop.tin')
      .where('shop.id = :id', { id: String(shopId) })
      .getOne();
    return row?.tin ?? null;
  }

  /** Optovik shartnoma maydonlari bilan (ular `select: false`). */
  private async getShopById(shopId: string): Promise<Shop> {
    const shop = /^\d+$/.test(String(shopId ?? ''))
      ? await this.shops
          .createQueryBuilder('shop')
          .addSelect(['shop.contractNumber', 'shop.contractDate'])
          .where('shop.id = :id AND shop.is_deleted = FALSE', {
            id: String(shopId),
          })
          .getOne()
      : null;
    if (!shop) throw new NotFoundException('Optovik topilmadi');
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

  private async getAdminProduct(id: string): Promise<Product> {
    const product = await this.products.findOne({
      where: { id, isDeleted: false },
      relations: { shop: true },
    });
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
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

  /** BE-07: slug global unikal (uq_catalog_product_slug); band bo‘lsa `-2`, `-3`… */
  private async uniqueSlug(name: string, ignoredId?: string): Promise<string> {
    const base = this.toSlug(name);
    let slug = base;
    let suffix = 2;
    while (true) {
      const existing = await this.products.findOne({ where: { slug } });
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

  private async publishChanged(product: Product, shop: Shop): Promise<void> {
    const event: CatalogProductChangedEvent = {
      productId: product.id,
      categoryId: product.categoryId,
      title: product.name,
      content: product.description,
      slug: product.slug,
      imageUrl: product.imageUrl,
      price: product.price,
      attributes: product.attributes,
      active:
        !product.isDeleted &&
        !product.isBlocked &&
        product.status === ProductStatus.ACTIVE &&
        !shop.isDeleted &&
        shop.status === ShopStatus.ACTIVE,
    };
    await this.emitChanged(event);
  }

  /** Qidiruvdan olib tashlash (`active: false`); arxivlash ham ishlatadi (`ProductArchiveService`). */
  publishRemoved(product: Product): Promise<void> {
    return this.emitChanged({
      productId: product.id,
      categoryId: product.categoryId,
      title: product.name,
      content: product.description,
      slug: product.slug,
      imageUrl: product.imageUrl,
      price: product.price,
      attributes: product.attributes,
      active: false,
    });
  }

  private async emitChanged(event: CatalogProductChangedEvent): Promise<void> {
    try {
      await firstValueFrom(this.search.emit('catalog.product.changed', event));
    } catch (error) {
      this.logger.warn(
        `Mahsulot ${event.productId} search event yuborilmadi: ${(error as Error).message}`,
      );
    }
  }

  private async emitProductHidden(
    product: Product,
    reason: string,
  ): Promise<void> {
    if (!product.ownerUserId) return; // BE-07: egasiz optovik mahsuloti — xabar oluvchi yo‘q
    try {
      await firstValueFrom(
        this.notifications.emit('product.hidden', {
          sellerUserId: product.ownerUserId,
          productId: product.id,
          productName: product.name,
          shopId: product.shopId,
          reason,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Mahsulot ${product.id} notification yuborilmadi: ${(error as Error).message}`,
      );
    }
  }
}

/**
 * BE-41 (EQ-09): CPA mahsuloti chekka chiqadi — Elchi kuryeri chekni MXIK va qadoq kodi bilan chiqaradi.
 * Kodsiz CPA mahsuloti sotuvga chiqmaydi (ega qarori 2026-11-22, [taklif]); asosiy sayt mahsulotiga (CPA emas) shart emas.
 */
export function assertFiscalCodes(
  product: Pick<Product, 'cpaEnabled' | 'mxikCode' | 'packageCode'>,
): void {
  if (product.cpaEnabled && (!product.mxikCode || !product.packageCode))
    throw new BadRequestException(
      'CPA mahsuloti uchun MXIK va qadoq kodini kiriting (fiskal chek)',
    );
}
