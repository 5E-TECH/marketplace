import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CatalogOfferListQuery,
  LEAD_CATALOG_RPC,
  RpcHttpExceptionFilter,
} from '@app/common';
import { CatalogOfferService } from './catalog-offer.service';

/** lead-service uchun offer ma’lumoti (BE-11 shartnomasi `LEAD_CATALOG_RPC`; BE-07). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class CatalogOfferController {
  constructor(private readonly offers: CatalogOfferService) {}

  @MessagePattern({ cmd: LEAD_CATALOG_RPC.OFFER_GET })
  get(@Payload() data: { productId: string }) {
    return this.offers.get(String(data?.productId ?? ''));
  }

  @MessagePattern({ cmd: LEAD_CATALOG_RPC.OFFER_LIST })
  list(@Payload() query: CatalogOfferListQuery) {
    return this.offers.list(query ?? {});
  }
}
