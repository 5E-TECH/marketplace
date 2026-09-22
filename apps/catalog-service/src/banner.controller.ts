import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateBannerDto,
  ReorderBannersDto,
  RpcHttpExceptionFilter,
  UpdateBannerDto,
} from '@app/common';
import { BannerService } from './banner.service';

/** C6.9 — bosh sahifa bannerlari. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class BannerController {
  constructor(private readonly banners: BannerService) {}

  @MessagePattern({ cmd: 'content.banners.admin-list' })
  adminList() {
    return this.banners.adminList();
  }

  @MessagePattern({ cmd: 'storefront.banners.list' })
  storefrontList() {
    return this.banners.storefrontList();
  }

  @MessagePattern({ cmd: 'content.banners.create' })
  create(@Payload() dto: CreateBannerDto) {
    return this.banners.create(dto);
  }

  @MessagePattern({ cmd: 'content.banners.reorder' })
  reorder(@Payload() dto: ReorderBannersDto) {
    return this.banners.reorder(dto);
  }

  @MessagePattern({ cmd: 'content.banners.update' })
  update(@Payload() data: { id: string; dto: UpdateBannerDto }) {
    return this.banners.update(data.id, data.dto);
  }

  @MessagePattern({ cmd: 'content.banners.remove' })
  remove(@Payload() data: { id: string }) {
    return this.banners.remove(data.id);
  }
}
