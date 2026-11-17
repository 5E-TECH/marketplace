import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CatalogOfferListQuery,
  CatalogOfferSnapshot,
  LEAD_CATALOG_RPC,
  RmqClient,
  sendRpc,
} from '@app/common';

/** Katalogdan offer ma’lumoti (BE-11). Katalog handlerlari — BE-07, BE-09 (Dilshod). */
@Injectable()
export class CatalogOfferClient {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  get(productId: string): Promise<CatalogOfferSnapshot | null> {
    return sendRpc(
      this.catalog,
      { cmd: LEAD_CATALOG_RPC.OFFER_GET },
      { productId },
    );
  }

  list(query: CatalogOfferListQuery): Promise<CatalogOfferSnapshot[]> {
    return sendRpc(this.catalog, { cmd: LEAD_CATALOG_RPC.OFFER_LIST }, query);
  }
}
