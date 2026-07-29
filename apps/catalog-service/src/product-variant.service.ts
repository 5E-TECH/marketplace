import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { Not, QueryFailedError, Repository } from 'typeorm';
import { ProductVariant } from './entities/product-variant.entity';
import { CreateProductVariantDto, UpdateProductVariantDto } from '@app/common';

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
      if (defaultVariant?.isActive) {
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

  private defaultSku(productId: string): string {
    return `PRODUCT-${productId}-DEFAULT`;
  }
}
