import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  AdminProductAttention,
  AdminProductExtra,
  AdminProductsQueryDto,
} from '@app/common';
import { CatalogOfferService } from './catalog-offer.service';
import { ProductService } from './product.service';

/**
 * BE-25 (FE-12): admin mahsulotlar ro‘yxati — filtrlar (kategoriya, kanal, «Diqqat») va qator qo‘shimchalari (ombor,
 * mijoz narxi, video; «bir so‘rovda, har qatorga alohida so‘rov emas» — fe-12 taklifi). Natijalar (lid statistikasi)
 * gateway da qo‘shiladi. Omborchiga qo‘shimchalar berilmaydi (`extras: false`).
 */
@Injectable()
export class AdminProductListService {
  constructor(
    private readonly products: ProductService,
    private readonly offers: CatalogOfferService,
  ) {}

  async list(query: AdminProductsQueryDto, extras = false) {
    let ids: string[] | undefined;
    if (query?.attention) {
      const found =
        query.attention === AdminProductAttention.OUT_OF_STOCK
          ? await this.offers.outOfStockIds()
          : await this.offers.expirySoonIds();
      if (!found)
        throw new ServiceUnavailableException(
          'Ombor javob bermadi — «Diqqat» filtri hozir ishlamaydi',
        );
      ids = found;
    }
    const page = await this.products.adminList(
      query ?? new AdminProductsQueryDto(),
      { ids },
    );
    if (!extras) return page;
    const { byId, unavailable } = await this.offers.adminListExtras(page.items);
    return {
      ...page,
      items: page.items.map((item) => {
        const extra = byId.get(String(item.id));
        return {
          ...item,
          stock: extra?.stock ?? null,
          listPrice: extra?.listPrice ?? null,
          hasVideo: extra?.hasVideo ?? null,
        };
      }),
      unavailable: unavailable as AdminProductExtra[],
    };
  }
}
