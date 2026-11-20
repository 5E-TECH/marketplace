import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import {
  CatalogOfferListQuery,
  CatalogOfferSnapshot,
  CatalogOrderSnapshot,
  ProductStatus,
  RmqClient,
  ShopStatus,
} from '@app/common';
import { ProductVariant } from './entities/product-variant.entity';
import { Product } from './entities/product.entity';
import {
  OfferPricing,
  PricingContext,
  PricingService,
} from './pricing.service';

/** Bitta so‘rovda qaytariladigan offerlar soni (lead-service o‘zi sahifalaydi). */
const LIST_LIMIT = 500;
/** inventory.available kutish chegarasi, ms (lead→catalog RPC 10 s dan ancha qisqa). */
const INVENTORY_TIMEOUT_MS = 1500;

/**
 * lead-service uchun katalog offer ma’lumoti (`LEAD_CATALOG_RPC`, BE-11 shartnomasi). BE-07 maydonlari:
 * mahsulot, og‘irlik, BAD, sotuvchi haqi, sotuvchilarga ochiqligi va sotuvdan olinganligi.
 * Narx (tasdiqlangan, eng katta) va ko‘rinadigan yetkazish — BE-09; qoldiq — BE-16 (HQ ombor). Keyingi kartalar
 * to‘ldiradi: kreativlar va video — BE-08/BE-27. Narx tasdiqlanmagan offerni lead-service ochmaydi.
 */
@Injectable()
export class CatalogOfferService {
  private readonly logger = new Logger(CatalogOfferService.name);

  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly pricing: PricingService,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
  ) {}

  /**
   * BE-16: bo‘sh qoldiq HQ omborda — mahsulotning faol varianti(lari) bo‘yicha (CPA da bitta). Inventory javob
   * bermasa — null (noma’lum): kelayotgan lid rad etilmaydi, sotuvchi esa yangi sahifa ocholmaydi.
   */
  private async stockOf(
    productIds: string[],
  ): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>(
      productIds.map((id) => [id, 0]),
    );
    if (!productIds.length) return result;
    const variants = await this.variants.find({
      where: { productId: In(productIds), isActive: true, isDeleted: false },
      select: { id: true, productId: true },
    });
    if (!variants.length) return result;
    try {
      // qisqa kutish: inventory osilib qolsa offer (va lid qabul qilish) uning ortidan kutib qolmasin
      const available = await firstValueFrom(
        this.inventory
          .send<Record<string, number>>(
            { cmd: 'inventory.available' },
            { variantIds: variants.map((v) => String(v.id)) },
          )
          .pipe(timeout(INVENTORY_TIMEOUT_MS)),
      );
      for (const v of variants) {
        const key = String(v.productId);
        result.set(
          key,
          (result.get(key) ?? 0) + (available[String(v.id)] ?? 0),
        );
      }
    } catch (error) {
      // noma’lum (null): sahifa va lid qabul qilish ochiq qoladi, yangi sahifa ochish — yopiq (lead-service)
      for (const id of productIds) result.set(id, null);
      this.logger.warn(`Qoldiq olinmadi: ${(error as Error).message}`);
    }
    return result;
  }

  async get(productId: string): Promise<CatalogOfferSnapshot | null> {
    if (!/^\d+$/.test(String(productId ?? ''))) return null;
    const product = await this.base()
      .where('product.id = :id', { id: String(productId) })
      .getOne();
    if (!product) return null;
    const stock = await this.stockOf([String(product.id)]);
    return toSnapshot(
      product,
      this.pricingOf(product, await this.pricing.context()),
      // null (noma’lum) saqlanadi — `?? 0` uni 0 ga aylantirib yuborardi
      stock.get(String(product.id)),
    );
  }

  /**
   * `productIds` berilsa — mavjud mahsulotlar holatidan qat’i nazar (o‘chirilgani ham, «Mening sahifalarim» uchun).
   * Aks holda faqat sotuvchilarga ochiq offerlar, qidiruv va kategoriya bo‘yicha.
   */
  async list(
    query: CatalogOfferListQuery = {},
  ): Promise<CatalogOfferSnapshot[]> {
    const qb = this.base();
    if (query.productIds) {
      const ids = query.productIds.map(String).filter((id) => /^\d+$/.test(id));
      if (!ids.length) return [];
      qb.where('product.id IN (:...ids)', { ids });
    } else {
      qb.where('product.is_deleted = FALSE')
        .andWhere('product.is_blocked = FALSE')
        .andWhere('product.cpa_enabled = TRUE')
        .andWhere('product.status = :active', { active: ProductStatus.ACTIVE })
        .andWhere('shop.is_deleted = FALSE')
        .andWhere('shop.status = :shopActive', {
          shopActive: ShopStatus.ACTIVE,
        });
      const search = query.search?.trim();
      if (search)
        qb.andWhere(
          new Brackets((w) =>
            w
              .where('product.name ILIKE :search')
              .orWhere('product.description ILIKE :search'),
          ),
          { search: `%${search}%` },
        );
      if (query.categoryId && /^\d+$/.test(String(query.categoryId)))
        qb.andWhere('product.category_id = :categoryId', {
          categoryId: String(query.categoryId),
        });
    }
    const rows = await qb
      // take() + join: TypeORM xossa nomini talab qiladi (ustun nomi emas)
      .orderBy('product.createdAt', 'DESC')
      .addOrderBy('product.id', 'DESC')
      .take(LIST_LIMIT)
      .getMany();
    if (!rows.length) return [];
    const ctx = await this.pricing.context();
    const stock = await this.stockOf(rows.map((row) => String(row.id)));
    return rows.map((row) =>
      toSnapshot(row, this.pricingOf(row, ctx), stock.get(String(row.id))),
    );
  }

  /** Narx sozlamasi buzilgan bo‘lsa ham offer qaytadi — narxsiz (lead-service uni ochmaydi). */
  private pricingOf(
    product: Product,
    ctx: PricingContext,
  ): OfferPricing | undefined {
    try {
      return this.pricing.offerPricing(product, ctx);
    } catch {
      return undefined;
    }
  }

  /**
   * BE-18: liddan buyurtma uchun narx nusxasi (NRX-10). Mahsulot yo‘q bo‘lsa — null. Faol variant — CPA da bitta
   * (BE-07); bir nechta bo‘lsa eng kichik ID li. Tasdiqlanmagan narx — `approvedPrice: null`.
   */
  async orderSnapshot(
    productId: string,
    quantity: number,
    whereDeliver: string,
  ): Promise<CatalogOrderSnapshot | null> {
    if (!/^\d+$/.test(String(productId ?? ''))) return null;
    const product = await this.base()
      .where('product.id = :id', { id: String(productId) })
      .getOne();
    if (!product) return null;
    const variant = await this.variants.findOne({
      where: {
        productId: String(product.id),
        isActive: true,
        isDeleted: false,
      },
      order: { id: 'ASC' },
    });
    const pricing = await this.pricing.orderPricing(
      product,
      quantity,
      whereDeliver,
    );
    return {
      productId: String(product.id),
      productName: product.name,
      variantId: variant ? String(variant.id) : null,
      sku: variant?.sku ?? null,
      wholesalerId: String(product.shopId),
      weightGrams: product.weightGrams!,
      cpaAvailable: isCpaAvailable(product),
      withdrawn: isWithdrawn(product),
      ...pricing,
    };
  }

  private base() {
    return this.products
      .createQueryBuilder('product')
      .innerJoinAndSelect('product.shop', 'shop')
      .leftJoinAndSelect('product.category', 'category');
  }
}

/** Sotuvchilarga ochiq: CPA yoqilgan, admin tasdiqlagan, bloklanmagan, o‘chirilmagan, optovigi faol (BE-07). */
export function isCpaAvailable(product: Product): boolean {
  return (
    product.cpaEnabled &&
    product.status === ProductStatus.ACTIVE &&
    !product.isBlocked &&
    !product.isDeleted &&
    !!product.shop &&
    !product.shop.isDeleted &&
    product.shop.status === ShopStatus.ACTIVE
  );
}

/** Sotuvdan olingan: o‘chirilgan, bloklangan, CPA o‘chirilgan, rad etilgan yoki arxivda, optovigi to‘xtatilgan. */
export function isWithdrawn(product: Product): boolean {
  return (
    product.isDeleted ||
    product.isBlocked ||
    !product.cpaEnabled ||
    [ProductStatus.REJECTED, ProductStatus.ARCHIVED].includes(product.status) ||
    !product.shop ||
    product.shop.isDeleted ||
    [ShopStatus.SUSPENDED, ShopStatus.REJECTED].includes(product.shop.status)
  );
}

export function toSnapshot(
  product: Product,
  pricing?: OfferPricing,
  stock: number | null = 0,
): CatalogOfferSnapshot {
  const images = product.images?.length
    ? product.images
    : product.imageUrl
      ? [product.imageUrl]
      : [];
  return {
    productId: String(product.id),
    name: product.name,
    subtitle: null,
    description: product.description,
    images,
    videoUrl: null, // BE-08/BE-27
    categoryId: product.categoryId,
    categoryName: product.category?.name ?? null,
    attributes: Object.entries(product.attributes ?? {})
      .filter(([, value]) =>
        ['string', 'number', 'boolean'].includes(typeof value),
      )
      .map(([name, value]) => ({ name, value: String(value) })),
    weightGrams: product.weightGrams,
    isBad: product.isBad,
    cpaAvailable: isCpaAvailable(product),
    withdrawn: isWithdrawn(product),
    // BE-09: tasdiqlangan narx, eng katta narx (NRX-4) va ko‘rinadigan yetkazish (bir dona)
    approvedPrice: pricing?.approvedPrice ?? null,
    maxSalePrice: pricing?.maxSalePrice ?? null,
    affiliateFee: product.affiliateFee,
    centerDeliveryFee: pricing?.centerDeliveryFee ?? 0,
    addressDeliveryFee: pricing?.addressDeliveryFee ?? 0,
    stock, // BE-16: HQ ombordagi bo‘sh (band qilinmagan) qoldiq
    creatives: [], // BE-08
    createdAt: new Date(product.createdAt).toISOString(),
  };
}
