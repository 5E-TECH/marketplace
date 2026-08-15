import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AdminShopsQueryDto, RpcHttpExceptionFilter } from '@app/common';
import { AdminShopService } from './admin-shop.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class AdminShopController {
  constructor(private readonly adminShops: AdminShopService) {}

  @MessagePattern({ cmd: 'catalog.shop.admin-list' })
  list(@Payload() data: { query?: AdminShopsQueryDto }) {
    return this.adminShops.adminList(data?.query ?? ({} as AdminShopsQueryDto));
  }

  @MessagePattern({ cmd: 'catalog.shop.count-by-status' })
  countByStatus() {
    return this.adminShops.countByStatus();
  }

  @MessagePattern({ cmd: 'catalog.shop.approve' })
  approve(@Payload() data: { shopId: string }) {
    return this.adminShops.adminApprove(String(data.shopId));
  }

  @MessagePattern({ cmd: 'catalog.shop.publish-approved' })
  publishApproved(
    @Payload()
    data: {
      sellerUserId: string;
      shopId: string;
      shopName?: string;
      phone?: string | null;
    },
  ) {
    return this.adminShops.publishShopApproved(data);
  }

  @MessagePattern({ cmd: 'catalog.shop.reject' })
  reject(@Payload() data: { shopId: string; reason?: string }) {
    return this.adminShops.adminReject(String(data.shopId), data.reason);
  }
}
