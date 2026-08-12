import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  RpcHttpExceptionFilter,
  StorefrontProductsQueryDto,
} from '@app/common';
import { StorefrontService } from './storefront.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @MessagePattern({ cmd: 'storefront.products.list' })
  list(@Payload() query: StorefrontProductsQueryDto) {
    return this.storefront.listProducts(query);
  }

  @MessagePattern({ cmd: 'storefront.products.get' })
  getProduct(@Payload() data: { id: string }) {
    return this.storefront.getProduct(data.id);
  }

  @MessagePattern({ cmd: 'storefront.shops.get' })
  getShop(
    @Payload()
    data: {
      slug: string;
      query: StorefrontProductsQueryDto;
    },
  ) {
    return this.storefront.getShop(data.slug, data.query);
  }

  @MessagePattern({ cmd: 'storefront.shops.products.list' })
  getShopProducts(
    @Payload()
    data: {
      shopId: string;
      query: StorefrontProductsQueryDto;
    },
  ) {
    return this.storefront.getShopProducts(data.shopId, data.query);
  }
}
