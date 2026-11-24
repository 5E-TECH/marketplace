import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateProductVariantDto,
  UpdateProductVariantDto,
  CatalogInventoryProduct,
} from '@app/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { Not, QueryFailedError, Repository } from 'typeorm';
import { ProductVariant } from './entities/product-variant.entity';

/** Admin qoldiq qidiruvida bitta so'rovga beriladigan variant id'lari chegarasi. */
export const ADMIN_VARIANT_SEARCH_LIMIT = 1000;

@Injectable()
export class ProductVariantService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(ProductVariant)
    private readonly productVariants: Repository<ProductVariant>,
  ) {}

  private async getOwnedProduct(
    ownerUserId: string,
    productId: string,
  ): Promise<Product> {
    const product = await this.products.findOne({
      where: {
        id: productId,
        isDeleted: false,
      },
    });

    if (!product) {
      throw new NotFoundException('Mahsulot topilmadi');
    }

    if (product.ownerUserId !== ownerUserId) {
      throw new ForbiddenException('Bu mahsulot sizga tegishli emas');
    }

    return product;
  }

  async createVariant(
    ownerUserId: string,
    productId: string,
    dto: CreateProductVariantDto,
  ): Promise<ProductVariant> {
    const product = await this.getOwnedProduct(ownerUserId, productId);
    // BE-07: CPA mahsulotida aniq bitta faol variant (birinchi variant sukutdagisini almashtiradi, ikkinchisi — 400)
    if (product.cpaEnabled && (dto.isActive ?? true))
      await this.assertNoOtherActiveVariant(productId);
    const productVariant = await this.productVariants.findOne({
      where: {
        sku: dto.sku,
      },
    });

    if (productVariant) {
      throw new ConflictException('Bunday SKU bilan variant mavjud');
    }

    const variant = this.productVariants.create({
      productId: product.id,
      sku: dto.sku,
      name: dto.name ?? null,
      attributes: dto.attributes ?? {},
      price: dto.price ?? null,
      oldPrice: dto.oldPrice ?? null,
      barcode: dto.barcode ?? null,
      imageUrl: dto.imageUrl ?? null,
      isActive: dto.isActive ?? true,
    });

    const defaultVariant = await this.productVariants.findOne({
      where: {
        productId,
        sku: this.defaultSku(productId),
        isDeleted: false,
      },
    });

    try {
      const createdVariant = await this.productVariants.save(variant);
      // BE-07: nofaol variant qo‘shilsa sukutdagisi faol qoladi (aks holda faol variant qolmasdi)
      if (defaultVariant?.isActive && createdVariant.isActive) {
        defaultVariant.isActive = false;
        await this.productVariants.save(defaultVariant);
      }

      product.hasVariants = true;
      await this.products.save(product);
      return createdVariant;
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === '23505'
      ) {
        throw new ConflictException('Bunday SKU bilan variant mavjud');
      }
      throw error;
    }
  }

  async getVariants(
    ownerUserId: string,
    productId: string,
  ): Promise<ProductVariant[]> {
    await this.getOwnedProduct(ownerUserId, productId);
    const variants = await this.productVariants.find({
      where: {
        productId: productId,
        isDeleted: false,
      },
    });
    return variants;
  }

  async getVariant(
    ownerUserId: string,
    productId: string,
    variantId: string,
  ): Promise<ProductVariant> {
    await this.getOwnedProduct(ownerUserId, productId);
    const variant = await this.productVariants.findOne({
      where: {
        id: variantId,
        productId: productId,
        isDeleted: false,
      },
    });

    if (!variant) {
      throw new NotFoundException('Bunday variant topilmadi');
    }
    return variant;
  }

  async updateProductVariant(
    ownerUserId: string,
    productId: string,
    variantId: string,
    dto: UpdateProductVariantDto,
  ): Promise<ProductVariant> {
    const variant = await this.getVariant(ownerUserId, productId, variantId);
    if (dto.isActive === true && !variant.isActive) {
      const product = await this.getOwnedProduct(ownerUserId, productId);
      if (product.cpaEnabled)
        await this.assertNoOtherActiveVariant(productId, variantId);
    }
    if (
      variant.sku === this.defaultSku(productId) &&
      dto.sku !== undefined &&
      dto.sku !== variant.sku
    ) {
      throw new ConflictException(
        'Default variant SKU sini o‘zgartirib bo‘lmaydi',
      );
    }
    if (dto.sku && dto.sku !== variant.sku) {
      const existingVariant = await this.productVariants.findOne({
        where: {
          sku: dto.sku,
        },
      });
      if (existingVariant && existingVariant.id !== variantId) {
        throw new ConflictException('Bunday SKU bilan variant mavjud');
      }
    }
    this.productVariants.merge(variant, dto);

    return this.productVariants.save(variant);
  }

  async deleteProductVariant(
    ownerUserId: string,
    productId: string,
    variantId: string,
  ): Promise<{ id: string; deleted: true }> {
    const product = await this.getOwnedProduct(ownerUserId, productId);
    const variant = await this.getVariant(ownerUserId, productId, variantId);
    if (variant.sku === this.defaultSku(productId)) {
      throw new ConflictException('Default variantni o‘chirib bo‘lmaydi');
    }

    variant.isDeleted = true;
    variant.isActive = false;
    await this.productVariants.save(variant);

    const remainingCustomVariant = await this.productVariants.findOne({
      where: {
        productId,
        id: Not(variantId),
        sku: Not(this.defaultSku(productId)),
        isDeleted: false,
      },
    });

    if (!remainingCustomVariant) {
      const defaultVariant = await this.productVariants.findOne({
        where: {
          productId,
          sku: this.defaultSku(productId),
          isDeleted: false,
        },
      });
      if (defaultVariant) {
        defaultVariant.isActive = true;
        await this.productVariants.save(defaultVariant);
      }
      product.hasVariants = false;
      await this.products.save(product);
    }

    return { id: variantId, deleted: true };
  }

  /**
   * BE-17: ombor qabuli uchun — CPA mahsulotining yagona faol varianti (SKU, shtrix-kod, optovik, BAD). Faol
   * variant yo‘q yoki mahsulot o‘chirilgan — ro‘yxatda yo‘q.
   */
  async inventoryProducts(
    productIds: string[],
  ): Promise<CatalogInventoryProduct[]> {
    const ids = [...new Set((productIds ?? []).map(String))].filter((id) =>
      /^[1-9]\d{0,18}$/.test(id),
    );
    if (!ids.length) return [];
    const variants = await this.productVariants
      .createQueryBuilder('variant')
      .innerJoinAndSelect('variant.product', 'product')
      .where('product.id IN (:...ids)', { ids })
      .andWhere('variant.is_deleted = FALSE')
      .andWhere('variant.is_active = TRUE')
      .andWhere('product.is_deleted = FALSE')
      // faqat CPA mahsuloti (BE-07): eski do‘kon mahsulotiga postavka e’lon qilinmaydi
      .andWhere('product.cpa_enabled = TRUE')
      .orderBy('variant.id', 'ASC')
      .getMany();
    const byProduct = new Map<string, CatalogInventoryProduct>();
    for (const variant of variants) {
      const productId = String(variant.productId);
      if (byProduct.has(productId)) continue; // CPA da bitta faol variant (BE-07); eng kichik id — order snapshot bilan bir xil
      byProduct.set(productId, {
        productId,
        productName: variant.product.name,
        variantId: String(variant.id),
        sku: variant.sku,
        barcode: variant.barcode ?? null,
        wholesalerId: String(variant.product.shopId),
        isBad: Boolean(variant.product.isBad),
      });
    }
    return [...byProduct.values()];
  }

  /** BE-16: ombor bitta (HQ) — optovik (`shopId`) berilmasa hamma variant, javobda mahsulot optovigi. */
  async getInventoryDetails(shopId: string | null, variantIds: string[]) {
    if (variantIds.length === 0) return [];

    const qb = this.productVariants
      .createQueryBuilder('variant')
      .innerJoinAndSelect('variant.product', 'product')
      .leftJoinAndSelect('product.shop', 'shop')
      .where('variant.id IN (:...variantIds)', { variantIds })
      .andWhere('variant.is_deleted = FALSE')
      .andWhere('product.is_deleted = FALSE');
    if (shopId) qb.andWhere('product.shop_id = :shopId', { shopId });
    const variants = await qb.getMany();

    return variants.map((variant) => ({
      wholesalerId: String(variant.product.shopId),
      // BE-25 (FE-16): «Qoldiq → Ro‘yxat» — optovik nomi va shtrix-kod
      wholesalerName: variant.product.shop?.name ?? null,
      variantId: variant.id,
      productId: variant.productId,
      productName: variant.product.name,
      variantName: variant.name,
      sku: variant.sku,
      barcode: variant.barcode ?? null,
    }));
  }

  /**
   * C6.7 — admin qoldiq qidiruvi uchun: matn (mahsulot nomi, variant nomi,
   * SKU) yoki mahsulot bo'yicha BARCHA do'konlardagi variant id'lari.
   *
   * Qoldiq inventory bazasida, nomlar esa shu yerda. Avval admin qoldig'i
   * hamma qatorni xotiraga yuklab, nom bo'yicha xotirada filtrlardi; endi
   * qidiruv avval id'larga aylanadi va inventory SQL'da sahifalaydi.
   */
  async searchVariantIdsForAdmin(input: {
    search?: string;
    productId?: string;
    /** BE-16: optovik bo‘yicha (ombor bitta, egalik mahsulot orqali). */
    wholesalerId?: string;
  }): Promise<{ variantIds: string[]; truncated: boolean }> {
    const qb = this.productVariants
      .createQueryBuilder('variant')
      .innerJoin('variant.product', 'product')
      .select('variant.id', 'id')
      .where('variant.is_deleted = FALSE')
      .andWhere('product.is_deleted = FALSE');
    if (input.productId) {
      qb.andWhere('variant.product_id = :productId', {
        productId: input.productId,
      });
    }
    if (input.wholesalerId) {
      qb.andWhere('product.shop_id = :wholesalerId', {
        wholesalerId: input.wholesalerId,
      });
    }
    const search = input.search?.trim();
    if (search) {
      // `%`/`_` foydalanuvchi matnida joker bo'lib qolmasin.
      const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      qb.andWhere(
        '(product.name ILIKE :pattern OR variant.name ILIKE :pattern OR variant.sku ILIKE :pattern)',
        { pattern },
      );
    }
    const rows = await qb
      .orderBy('variant.id', 'ASC')
      .limit(ADMIN_VARIANT_SEARCH_LIMIT + 1)
      .getRawMany<{ id: string }>();
    return {
      variantIds: rows
        .slice(0, ADMIN_VARIANT_SEARCH_LIMIT)
        .map((row) => String(row.id)),
      truncated: rows.length > ADMIN_VARIANT_SEARCH_LIMIT,
    };
  }

  /** CPA mahsulotida sukutdagidan boshqa faol variant bo‘lsa — 400 (qoldiq va band shu bitta variant orqali). */
  private async assertNoOtherActiveVariant(
    productId: string,
    exceptId?: string,
  ): Promise<void> {
    const others = await this.productVariants.count({
      where: {
        productId,
        isActive: true,
        isDeleted: false,
        sku: Not(this.defaultSku(productId)),
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });
    if (others > 0)
      throw new BadRequestException(
        'CPA mahsulotida faqat bitta faol variant bo‘ladi',
      );
  }

  private defaultSku(productId: string): string {
    return `PRODUCT-${productId}-DEFAULT`;
  }
}
