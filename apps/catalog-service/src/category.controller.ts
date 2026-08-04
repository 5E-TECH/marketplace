import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateCategoryDto,
  RpcHttpExceptionFilter,
  UpdateCategoryDto,
} from '@app/common';
import { CategoryService } from './category.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @MessagePattern({ cmd: 'category.public-tree' })
  publicTree() {
    return this.categories.getPublicTree();
  }

  @MessagePattern({ cmd: 'category.admin-tree' })
  adminTree() {
    return this.categories.getAdminTree();
  }

  @MessagePattern({ cmd: 'category.create' })
  create(@Payload() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @MessagePattern({ cmd: 'category.update' })
  update(@Payload() data: { id: string; dto: UpdateCategoryDto }) {
    return this.categories.update(data.id, data.dto);
  }

  @MessagePattern({ cmd: 'category.delete' })
  remove(@Payload() data: { id: string }) {
    return this.categories.remove(data.id);
  }
}
