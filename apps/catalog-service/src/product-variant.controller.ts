import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateProductVariantDto,
  RpcHttpExceptionFilter,
  UpdateProductVariantDto,
} from '@app/common';
import { ProductVariantService } from './product-variant.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class ProductVariantController {
  constructor(private readonly variants: ProductVariantService) {}

  @MessagePattern({ cmd: 'product-variant.create' })
  create(
    @Payload()
    data: {
      ownerUserId: string;
      productId: string;
      dto: CreateProductVariantDto;
    },
  ) {
    return this.variants.createVariant(
      data.ownerUserId,
      data.productId,
      data.dto,
    );
  }

  @MessagePattern({ cmd: 'product-variant.list' })
  list(@Payload() data: { ownerUserId: string; productId: string }) {
    return this.variants.getVariants(data.ownerUserId, data.productId);
  }

  @MessagePattern({ cmd: 'product-variant.get-one' })
  getOne(
    @Payload()
    data: {
      ownerUserId: string;
      productId: string;
      variantId: string;
    },
  ) {
    return this.variants.getVariant(
      data.ownerUserId,
      data.productId,
      data.variantId,
    );
  }

  @MessagePattern({ cmd: 'product-variant.update' })
  update(
    @Payload()
    data: {
      ownerUserId: string;
      productId: string;
      variantId: string;
      dto: UpdateProductVariantDto;
    },
  ) {
    return this.variants.updateProductVariant(
      data.ownerUserId,
      data.productId,
      data.variantId,
      data.dto,
    );
  }

  @MessagePattern({ cmd: 'product-variant.delete' })
  remove(
    @Payload()
    data: {
      ownerUserId: string;
      productId: string;
      variantId: string;
    },
  ) {
    return this.variants.deleteProductVariant(
      data.ownerUserId,
      data.productId,
      data.variantId,
    );
  }

  @MessagePattern({ cmd: 'inventory.variant-details' })
  inventoryDetails(@Payload() data: { shopId: string; variantIds: string[] }) {
    return this.variants.getInventoryDetails(data.shopId, data.variantIds);
  }
}
