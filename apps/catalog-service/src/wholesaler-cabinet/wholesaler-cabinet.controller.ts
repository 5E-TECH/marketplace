import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateProductDto,
  LegalDocumentDto,
  ReviewWholesalerInput,
  RpcHttpExceptionFilter,
  SelfRegisterWholesalerInput,
  WHOLESALER_CABINET_RPC as RPC,
  WholesalerDocumentKind,
  WholesalerPricingQueryDto,
  WholesalerProductsQueryDto,
} from '@app/common';
import { WholesalerCabinetService } from './wholesaler-cabinet.service';
import { wholesalerContractPdf } from './wholesaler-contract-pdf';

/** BE-30: optovik kabineti (gateway `wholesaler/*`, `auth/register/wholesaler`, `admin/wholesalers/*`). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class WholesalerCabinetController {
  constructor(private readonly svc: WholesalerCabinetService) {}

  @MessagePattern({ cmd: RPC.TIN_FREE })
  tinFree(@Payload() data: { tin: string }) {
    return this.svc.tinFree(data?.tin);
  }

  @MessagePattern({ cmd: RPC.SELF_REGISTER })
  selfRegister(@Payload() data: SelfRegisterWholesalerInput) {
    return this.svc.selfRegister(data);
  }

  @MessagePattern({ cmd: RPC.REVIEW })
  review(@Payload() data: ReviewWholesalerInput) {
    return this.svc.review(data);
  }

  @MessagePattern({ cmd: RPC.LINK_OWNER })
  linkOwner(@Payload() data: { wholesalerId: string; ownerUserId: string }) {
    return this.svc.linkOwner(data);
  }

  @MessagePattern({ cmd: RPC.ME })
  me(@Payload() data: { ownerUserId: string }) {
    return this.svc.me(String(data?.ownerUserId ?? ''));
  }

  @MessagePattern({ cmd: RPC.PRODUCT_CREATE })
  createProduct(
    @Payload() data: { ownerUserId: string; dto: CreateProductDto },
  ) {
    return this.svc.createProduct(String(data?.ownerUserId ?? ''), data?.dto);
  }

  @MessagePattern({ cmd: RPC.PRODUCT_LIST })
  listProducts(
    @Payload()
    data: {
      ownerUserId: string;
      query?: WholesalerProductsQueryDto;
    },
  ) {
    return this.svc.listProducts(
      String(data?.ownerUserId ?? ''),
      data?.query ?? {},
    );
  }

  @MessagePattern({ cmd: RPC.PRODUCT_GET })
  getProduct(@Payload() data: { ownerUserId: string; productId: string }) {
    return this.svc.getProduct(
      String(data?.ownerUserId ?? ''),
      String(data?.productId ?? ''),
    );
  }

  @MessagePattern({ cmd: RPC.PRICING })
  pricing(
    @Payload()
    data: {
      ownerUserId: string;
      productId: string;
      query?: WholesalerPricingQueryDto;
    },
  ) {
    return this.svc.pricingView(
      String(data?.ownerUserId ?? ''),
      String(data?.productId ?? ''),
      data?.query ?? {},
    );
  }

  @MessagePattern({ cmd: RPC.VARIANTS })
  variants(@Payload() data: { wholesalerId: string }) {
    return this.svc.variants(String(data?.wholesalerId ?? ''));
  }

  @MessagePattern({ cmd: RPC.DOCUMENT_ADD })
  addDocument(
    @Payload()
    data: {
      ownerUserId: string;
      kind: WholesalerDocumentKind;
      productId?: string | null;
      objectKey: string;
      fileName: string;
      contentType: string;
      size: number;
    },
  ) {
    return this.svc.addDocument(data);
  }

  @MessagePattern({ cmd: RPC.DOCUMENT_LIST })
  listDocuments(@Payload() data: { wholesalerId: string }) {
    return this.svc.listDocuments(String(data?.wholesalerId ?? ''));
  }

  @MessagePattern({ cmd: RPC.DOCUMENT_GET })
  getDocument(@Payload() data: { id: string }) {
    return this.svc.getDocument(String(data?.id ?? ''));
  }

  /** Shartnoma PDF — matn identity dan (gateway beradi), rekvizitlar shu yerdan. */
  @MessagePattern({ cmd: RPC.CONTRACT_PDF })
  async contractPdf(
    @Payload() data: { wholesalerId: string; contract: LegalDocumentDto },
  ) {
    const shop = await this.svc.byId(data?.wholesalerId);
    return wholesalerContractPdf(await this.svc.profile(shop), data.contract);
  }
}
