import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateProductDto,
  AdminProductsQueryDto,
  MyProductsQueryDto,
  RpcHttpExceptionFilter,
  UpdateProductDto,
} from '@app/common';
import { ProductService } from './product.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @MessagePattern({ cmd: 'product.create' })
  create(@Payload() data: { ownerUserId: string; dto: CreateProductDto }) {
    return this.products.create(data.ownerUserId, data.dto);
  }

  @MessagePattern({ cmd: 'product.get-mine' })
  getMine(@Payload() data: { ownerUserId: string; query: MyProductsQueryDto }) {
    return this.products.getMine(data.ownerUserId, data.query);
  }

  @MessagePattern({ cmd: 'product.get-one' })
  getOne(@Payload() data: { ownerUserId: string; id: string }) {
    return this.products.getOne(data.ownerUserId, data.id);
  }

  @MessagePattern({ cmd: 'product.add-image' })
  addImage(
    @Payload()
    data: {
      ownerUserId: string;
      id: string;
      url: string;
      isCover: boolean;
    },
  ) {
    return this.products.addImage(
      data.ownerUserId,
      data.id,
      data.url,
      data.isCover,
    );
  }

  @MessagePattern({ cmd: 'product.update' })
  update(
    @Payload()
    data: {
      ownerUserId: string;
      id: string;
      dto: UpdateProductDto;
    },
  ) {
    return this.products.update(data.ownerUserId, data.id, data.dto);
  }

  @MessagePattern({ cmd: 'product.delete' })
  remove(@Payload() data: { ownerUserId: string; id: string }) {
    return this.products.remove(data.ownerUserId, data.id);
  }

  @MessagePattern({ cmd: 'catalog.product.admin-list' })
  adminList(@Payload() data: { query: AdminProductsQueryDto }) {
    return this.products.adminList(data.query);
  }

  @MessagePattern({ cmd: 'catalog.product.admin-get' })
  adminGet(@Payload() data: { productId: string }) {
    return this.products.adminGet(String(data.productId));
  }

  @MessagePattern({ cmd: 'catalog.product.admin-suspend' })
  adminSuspend(@Payload() data: { productId: string }) {
    return this.products.adminSuspend(String(data.productId));
  }

  @MessagePattern({ cmd: 'catalog.product.admin-reactivate' })
  adminReactivate(@Payload() data: { productId: string }) {
    return this.products.adminReactivate(String(data.productId));
  }
}
