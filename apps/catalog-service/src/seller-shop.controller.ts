import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RpcHttpExceptionFilter, UpdateSellerShopDto } from '@app/common';
import { SellerShopService } from './seller-shop.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class SellerShopController {
  constructor(private readonly sellerShops: SellerShopService) {}

  @MessagePattern({ cmd: 'seller.shop.get-me' })
  getMine(@Payload() data: { ownerUserId: string }) {
    return this.sellerShops.getMine(data.ownerUserId);
  }

  @MessagePattern({ cmd: 'seller.shop.update-me' })
  updateMine(
    @Payload()
    data: {
      ownerUserId: string;
      dto: UpdateSellerShopDto;
    },
  ) {
    return this.sellerShops.updateMine(data.ownerUserId, data.dto);
  }

  /**
   * Elchi market id'ni shopga yozadi (elchi-integration provisioningdan keyin
   * chaqiradi). Idempotent — bir xil qiymat bilan qayta yozish xavfsiz.
   */
  @MessagePattern({ cmd: 'catalog.shop.set-elchi-market-id' })
  setElchiMarketId(@Payload() data: { shopId: string; elchiMarketId: string }) {
    return this.sellerShops.setElchiMarketId(data.shopId, data.elchiMarketId);
  }

  @MessagePattern({ cmd: 'catalog.shop.get-by-id' })
  getById(@Payload() data: { shopId: string }) {
    return this.sellerShops.getById(data.shopId);
  }
}
