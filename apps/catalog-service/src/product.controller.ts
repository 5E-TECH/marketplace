import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AdminCreateProductDto,
  AdminUpdateProductDto,
  CreateProductDto,
  AdminProductsQueryDto,
  MyProductsQueryDto,
  CATALOG_UPSELL_RPC,
  PRODUCT_ARCHIVE_RPC,
  RpcHttpExceptionFilter,
  UpdateProductDto,
} from '@app/common';
import { ProductService } from './product.service';
import { ProductArchiveService } from './product-archive.service';
import { ProductUpsellService } from './product-upsell.service';
import { AdminProductListService } from './admin-product-list.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class ProductController {
  constructor(
    private readonly products: ProductService,
    private readonly archives: ProductArchiveService,
    private readonly lists: AdminProductListService,
    private readonly upsells: ProductUpsellService,
  ) {}

  @MessagePattern({ cmd: 'product.create' })
  create(@Payload() data: { ownerUserId: string; dto: CreateProductDto }) {
    return this.products.create(data.ownerUserId, data.dto);
  }

  @MessagePattern({ cmd: 'catalog.product.admin-create' })
  adminCreate(@Payload() data: { dto: AdminCreateProductDto }) {
    return this.products.adminCreate(String(data.dto.wholesalerId), data.dto);
  }

  @MessagePattern({ cmd: 'catalog.product.admin-update' })
  adminUpdate(
    @Payload() data: { productId: string; dto: AdminUpdateProductDto },
  ) {
    return this.products.adminUpdate(String(data.productId), data.dto);
  }

  @MessagePattern({ cmd: 'catalog.product.admin-approve' })
  adminApprove(@Payload() data: { productId: string }) {
    return this.products.adminApprove(String(data.productId));
  }

  @MessagePattern({ cmd: 'catalog.product.admin-reject' })
  adminReject(@Payload() data: { productId: string; reason: string }) {
    return this.products.adminReject(String(data.productId), data.reason);
  }

  @MessagePattern({ cmd: 'product.get-mine' })
  getMine(@Payload() data: { ownerUserId: string; query: MyProductsQueryDto }) {
    return this.products.getMine(data.ownerUserId, data.query);
  }

  @MessagePattern({ cmd: 'product.get-one' })
  getOne(@Payload() data: { ownerUserId: string; id: string }) {
    return this.products.getOne(data.ownerUserId, data.id);
  }

  @MessagePattern({ cmd: 'product.add-image' })
  addImage(
    @Payload()
    data: {
      ownerUserId: string;
      id: string;
      url: string;
      isCover: boolean;
    },
  ) {
    return this.products.addImage(
      data.ownerUserId,
      data.id,
      data.url,
      data.isCover,
    );
  }

  @MessagePattern({ cmd: 'product.update' })
  update(
    @Payload()
    data: {
      ownerUserId: string;
      id: string;
      dto: UpdateProductDto;
    },
  ) {
    return this.products.update(data.ownerUserId, data.id, data.dto);
  }

  @MessagePattern({ cmd: 'product.delete' })
  remove(@Payload() data: { ownerUserId: string; id: string }) {
    return this.products.remove(data.ownerUserId, data.id);
  }

  /** BE-25 (FE-12): `extras` — ombor, mijoz narxi, video (omborchiga false). */
  @MessagePattern({ cmd: 'catalog.product.admin-list' })
  adminList(
    @Payload() data: { query: AdminProductsQueryDto; extras?: boolean },
  ) {
    return this.lists.list(data?.query, data?.extras === true);
  }

  @MessagePattern({ cmd: 'catalog.product.admin-get' })
  adminGet(@Payload() data: { productId: string }) {
    return this.products.adminGet(String(data.productId));
  }

  @MessagePattern({ cmd: 'catalog.product.admin-suspend' })
  adminSuspend(@Payload() data: { productId: string }) {
    return this.products.adminSuspend(String(data.productId));
  }

  @MessagePattern({ cmd: 'catalog.product.admin-hide' })
  adminHide(@Payload() data: { productId: string; reason: string }) {
    return this.products.adminHide(String(data.productId), data.reason);
  }

  @MessagePattern({ cmd: 'catalog.product.admin-reactivate' })
  adminReactivate(@Payload() data: { productId: string }) {
    return this.products.adminReactivate(String(data.productId));
  }

  /** BE-25 (FE-25): arxivlash — qoldiq va ochiq buyurtma tekshiriladi. */
  @MessagePattern({ cmd: PRODUCT_ARCHIVE_RPC.ARCHIVE })
  adminArchive(@Payload() data: { productId: string }) {
    return this.archives.archive(String(data?.productId ?? ''));
  }

  /** BE-45: upsell juftligi (null — olib tashlash). */
  @MessagePattern({ cmd: CATALOG_UPSELL_RPC.SET_PAIR })
  setUpsellPair(
    @Payload() data: { productId: string; pairProductId: string | null },
  ) {
    return this.upsells.setPair(
      String(data?.productId ?? ''),
      data?.pairProductId ?? null,
    );
  }
}
