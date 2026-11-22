import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  RpcHttpExceptionFilter,
  StorefrontProductsQueryDto,
} from '@app/common';
import { StorefrontService } from './storefront.service';

/** BE-34: asosiy sayt katalogi (ochiq). Eski do‘kon sahifalari (`storefront.shops.*`) BE-34 da olib tashlandi. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @MessagePattern({ cmd: 'storefront.products.list' })
  list(@Payload() query: StorefrontProductsQueryDto) {
    return this.storefront.listProducts(query ?? {});
  }

  @MessagePattern({ cmd: 'storefront.products.get' })
  getProduct(@Payload() data: { id: string }) {
    return this.storefront.getProduct(String(data?.id ?? ''));
  }

  /** checkout savati: tasdiqlangan narx bilan (BE-34). */
  @MessagePattern({ cmd: 'cart.variant.get' })
  cartVariant(@Payload() data: { productId: string; variantId?: string }) {
    return this.storefront.cartVariant(
      String(data?.productId ?? ''),
      data?.variantId ? String(data.variantId) : undefined,
    );
  }
}
