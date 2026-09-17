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

  @MessagePattern({ cmd: 'catalog.shop.admin-detail' })
  detail(@Payload() data: { shopId: string }) {
    return this.adminShops.adminDetail(String(data.shopId));
  }

  @MessagePattern({ cmd: 'catalog.shop.suspend' })
  suspend(@Payload() data: { shopId: string }) {
    return this.adminShops.adminSuspend(String(data.shopId));
  }

  @MessagePattern({ cmd: 'catalog.shop.activate' })
  activate(@Payload() data: { shopId: string }) {
    return this.adminShops.adminActivate(String(data.shopId));
  }

  @MessagePattern({ cmd: 'catalog.shop.feature' })
  feature(@Payload() data: { shopId: string; featured: boolean }) {
    return this.adminShops.adminFeature(
      String(data.shopId),
      Boolean(data.featured),
    );
  }

  @MessagePattern({ cmd: 'catalog.shop.update-tariffs' })
  updateTariffs(
    @Payload()
    data: {
      shopId: string;
      tariffHome: number;
      tariffCenter: number;
    },
  ) {
    return this.adminShops.adminUpdateTariffs(
      String(data.shopId),
      Number(data.tariffHome),
      Number(data.tariffCenter),
    );
  }

  @MessagePattern({ cmd: 'catalog.shop.publish-approved' })
  async publishApproved(
    @Payload()
    data: {
      sellerUserId: string;
      shopId: string;
      shopName?: string;
      phone?: string | null;
      regionId?: string | null;
      districtId?: string | null;
      tariffHome?: number;
      tariffCenter?: number;
    },
  ) {
    await this.adminShops.publishShopApproved(data);
    // RMQ request/reply handler `undefined` qaytarsa javob freymi chiqmaydi va
    // gateway'dagi firstValueFrom "no elements in sequence" bilan 500 beradi.
    return { published: true };
  }

  @MessagePattern({ cmd: 'catalog.shop.reject' })
  reject(@Payload() data: { shopId: string; reason?: string }) {
    return this.adminShops.adminReject(String(data.shopId), data.reason);
  }
}
