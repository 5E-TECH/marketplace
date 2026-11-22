import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CatalogOfferListQuery,
  CatalogOfferSnapshot,
  CatalogOrderSnapshotMany,
  LEAD_CATALOG_RPC,
  LEAD_ORDER_RPC,
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

  /** BE-34: saytdan buyurtma SMS matni uchun posilka yetkazishi — buyurtma bilan bir xil hisob. */
  orderSnapshotMany(
    items: Array<{ productId: string; quantity: number }>,
    whereDeliver: string,
  ): Promise<CatalogOrderSnapshotMany> {
    return sendRpc(
      this.catalog,
      { cmd: LEAD_ORDER_RPC.CATALOG_SNAPSHOT_MANY },
      { items, whereDeliver },
    );
  }
}
