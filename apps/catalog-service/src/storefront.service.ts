import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CartCatalogVariantDto,
  CatalogOfferSnapshot,
  StorefrontProductDetailsDto,
  StorefrontProductDto,
  StorefrontProductsPageDto,
  StorefrontProductsQueryDto,
} from '@app/common';
import { CatalogOfferService } from './catalog-offer.service';
import { ProductVariant } from './entities/product-variant.entity';

/** «Shu bo‘limdan» javonidagi mahsulotlar soni [taklif]. */
export const RELATED_LIMIT = 8;

/**
 * Saytda sotiladi: sotuvdan olinmagan, sotuvchilarga ochiq offer (faol, bloklanmagan, CPA, video bilan — BE-07, BE-27)
 * va tasdiqlangan narxi bor (BE-09). Sayt narxi — tasdiqlangan narx (TZ SAYT-2).
 */
export function isOnSite(
  offer: CatalogOfferSnapshot | null | undefined,
): offer is CatalogOfferSnapshot & { approvedPrice: number } {
  return (
    !!offer &&
    !offer.withdrawn &&
    offer.cpaAvailable &&
    offer.approvedPrice !== null
  );
}

/** Ochiq DTO: faqat ruxsat etilgan maydonlar (bazaviy narx, sotuvchi haqi, optovik ma’lumoti, qoldiq soni yo‘q). */
export function toStorefrontProduct(
  offer: CatalogOfferSnapshot & { approvedPrice: number },
): StorefrontProductDto {
  return {
    id: offer.productId,
    name: offer.name,
    subtitle: offer.subtitle,
    description: offer.description,
    images: offer.images,
    videoUrl: offer.videoUrl,
    category: offer.categoryId
      ? { id: offer.categoryId, name: offer.categoryName ?? '' }
      : null,
    attributes: offer.attributes.map(({ name, value }) => ({ name, value })),
    isBad: offer.isBad,
    price: offer.approvedPrice,
    deliveryToCenter: offer.centerDeliveryFee,
    deliveryToAddress: offer.addressDeliveryFee,
    inStock: offer.stock === null ? null : offer.stock > 0,
  };
}

/**
 * BE-34: asosiy sayt katalogi. Offerlar katalog offer ro‘yxatidan (`CatalogOfferService.list`, bitta so‘rovda 500 tagacha)
 * olinadi va narx, qoldiq, saralash va sahifalash shu yerda — MVP hajmida (yuzlab mahsulot) yetadi [taklif].
 */
@Injectable()
export class StorefrontService {
  constructor(
    private readonly offers: CatalogOfferService,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
  ) {}

  /**
   * Savatga qo‘shish (`cart.variant.get`, checkout chaqiradi): faqat saytda sotuvdagi mahsulot, narx — tasdiqlangan
   * narx (SAYT-2; eski variant narxi ichki narx edi — BE-18 savatni shu sabab yopgan). Variant ko‘rsatilmasa — CPA
   * mahsulotining yagona faol varianti (BE-07).
   */
  async cartVariant(
    productId: string,
    variantId?: string,
  ): Promise<CartCatalogVariantDto> {
    const offer = await this.offers.get(productId);
    if (!isOnSite(offer))
      throw new NotFoundException('Sotuvdagi mahsulot topilmadi');
    const variant = await this.variants.findOne({
      where: {
        productId: offer.productId,
        isActive: true,
        isDeleted: false,
        ...(variantId ? { id: String(variantId) } : {}),
      },
      relations: { product: true },
      order: { id: 'ASC' },
    });
    if (!variant) throw new NotFoundException('Sotuvdagi variant topilmadi');
    return {
      productId: offer.productId,
      variantId: String(variant.id),
      shopId: String(variant.product.shopId),
      unitPrice: offer.approvedPrice,
      // savatga suratga olinadi va buyurtma orqali Elchi’ga boradi (bo‘sh nomni Elchi rad etadi)
      productName: offer.name,
    };
  }

  async listProducts(
    query: Partial<StorefrontProductsQueryDto>,
  ): Promise<StorefrontProductsPageDto> {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    )
      throw new BadRequestException(
        'minPrice maxPrice dan katta bo‘la olmaydi',
      );
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const items = (
      await this.offers.list({
        search: query.search,
        categoryId: query.categoryId,
      })
    )
      .filter(isOnSite)
      .filter(
        (offer) =>
          (query.minPrice === undefined ||
            offer.approvedPrice >= query.minPrice) &&
          (query.maxPrice === undefined ||
            offer.approvedPrice <= query.maxPrice) &&
          // «faqat mavjud»: qoldig‘i 0 lar chiqmaydi; noma’lum (ombor javob bermadi) — ko‘rsatiladi
          (!query.inStock || offer.stock === null || offer.stock > 0),
      )
      .map(toStorefrontProduct);
    const [field, direction] = String(query.sort ?? 'createdAt:desc').split(
      ':',
    );
    const sign = direction === 'asc' ? 1 : -1;
    // offer ro‘yxati yangi → eski tartibda keladi (createdAt:desc)
    if (field === 'price')
      items.sort(
        (a, b) => sign * (a.price - b.price) || Number(b.id) - Number(a.id),
      );
    else if (field === 'name')
      items.sort((a, b) => sign * a.name.localeCompare(b.name, 'uz'));
    else if (direction === 'asc') items.reverse();
    const total = items.length;
    return {
      items: items.slice((page - 1) * limit, page * limit),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async getProduct(id: string): Promise<StorefrontProductDetailsDto> {
    const offer = await this.offers.get(id);
    if (!isOnSite(offer)) throw new NotFoundException('Mahsulot topilmadi');
    const related = offer.categoryId
      ? (await this.offers.list({ categoryId: offer.categoryId }))
          .filter(isOnSite)
          .filter((other) => other.productId !== offer.productId)
          .slice(0, RELATED_LIMIT)
          .map(toStorefrontProduct)
      : [];
    return { ...toStorefrontProduct(offer), related };
  }
}
