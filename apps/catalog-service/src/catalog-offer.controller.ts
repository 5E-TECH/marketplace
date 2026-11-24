import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CATALOG_DISPLAY_LOOKUP,
  CatalogDisplayLookupRequest,
  CATALOG_MODERATION_RPC,
  CatalogOfferListQuery,
  LEAD_CATALOG_RPC,
  LEAD_ORDER_RPC,
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

  /** BE-18: checkout liddan buyurtma yaratishda narx nusxasini oladi. */
  @MessagePattern({ cmd: LEAD_ORDER_RPC.CATALOG_SNAPSHOT })
  orderSnapshot(
    @Payload()
    data: {
      productId: string;
      quantity: number;
      whereDeliver: string;
    },
  ) {
    return this.offers.orderSnapshot(
      String(data?.productId ?? ''),
      Number(data?.quantity),
      String(data?.whereDeliver ?? ''),
    );
  }

  /** BE-34: saytdan ko‘p tovarli buyurtma — har tovar nusxasi va butun posilka yetkazishi. */
  @MessagePattern({ cmd: LEAD_ORDER_RPC.CATALOG_SNAPSHOT_MANY })
  orderSnapshotMany(
    @Payload()
    data: {
      items: Array<{ productId: string; quantity: number }>;
      whereDeliver: string;
    },
  ) {
    return this.offers.orderSnapshotMany(
      data?.items ?? [],
      String(data?.whereDeliver ?? ''),
    );
  }

  @MessagePattern({ cmd: CATALOG_MODERATION_RPC.SUMMARY })
  moderationSummary() {
    return this.offers.moderationSummary();
  }

  /** BE-25 (FE-13): narx navbati. */
  @MessagePattern({ cmd: CATALOG_MODERATION_RPC.PRICES })
  priceQueue() {
    return this.offers.priceQueue();
  }

  @MessagePattern({ cmd: LEAD_CATALOG_RPC.OFFER_LIST })
  list(@Payload() query: CatalogOfferListQuery) {
    return this.offers.list(query ?? {});
  }

  /** BE-29: checkout (eski qaytarishlar ro‘yxati) uchun do‘kon nomi va mahsulot rasmi. */
  @MessagePattern({ cmd: CATALOG_DISPLAY_LOOKUP })
  displayLookup(@Payload() data: CatalogDisplayLookupRequest) {
    return this.offers.displayLookup(data);
  }
}
