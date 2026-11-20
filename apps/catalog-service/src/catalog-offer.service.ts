import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  CatalogOfferListQuery,
  CatalogOfferSnapshot,
  ProductStatus,
  ShopStatus,
} from '@app/common';
import { Product } from './entities/product.entity';

/** Bitta so‘rovda qaytariladigan offerlar soni (lead-service o‘zi sahifalaydi). */
const LIST_LIMIT = 500;

/**
 * lead-service uchun katalog offer ma’lumoti (`LEAD_CATALOG_RPC`, BE-11 shartnomasi). BE-07 maydonlari:
 * mahsulot, og‘irlik, BAD, sotuvchi haqi, sotuvchilarga ochiqligi va sotuvdan olinganligi.
 * Keyingi kartalar to‘ldiradi: tasdiqlangan narx, eng katta narx va ko‘rinadigan yetkazish — BE-09; qoldiq — BE-16/BE-17;
 * kreativlar va video — BE-08/BE-27. Ungacha `approvedPrice` bo‘sh — lead-service bunday offerni ochmaydi.
 */
@Injectable()
export class CatalogOfferService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
  ) {}

  async get(productId: string): Promise<CatalogOfferSnapshot | null> {
    if (!/^\d+$/.test(String(productId ?? ''))) return null;
    const product = await this.base()
      .where('product.id = :id', { id: String(productId) })
      .getOne();
    return product ? toSnapshot(product) : null;
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
    return rows.map(toSnapshot);
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

export function toSnapshot(product: Product): CatalogOfferSnapshot {
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
    approvedPrice: null, // BE-09: narx kalkulyatori va narx tasdig‘i
    maxSalePrice: null, // BE-09
    affiliateFee: product.affiliateFee,
    centerDeliveryFee: 0, // BE-09: ko‘rinadigan yetkazish
    addressDeliveryFee: 0, // BE-09
    stock: 0, // BE-16/BE-17: band qilinmagan qoldiq
    creatives: [], // BE-08
    createdAt: new Date(product.createdAt).toISOString(),
  };
}
