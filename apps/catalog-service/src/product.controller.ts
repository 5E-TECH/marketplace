import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateProductDto,
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
}
