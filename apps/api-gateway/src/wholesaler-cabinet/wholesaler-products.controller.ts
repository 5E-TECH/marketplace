import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CreateProductDto,
  CurrentUser,
  JwtUser,
  ProductMediaDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  ShopStatus,
  WHOLESALER_CABINET_RPC as RPC,
  WholesalerPricingQueryDto,
  WholesalerProductsQueryDto,
} from '@app/common';
import { WHOLESALER_PRICING_EXAMPLE } from '../admin/admin-pricing.examples';
import { FileTooLargeInterceptor } from '../affiliate-account/affiliate-self-employed.controller';
import {
  PRODUCT_MEDIA_BODY,
  PRODUCT_MEDIA_OPTIONS,
  storeProductMedia,
} from '../admin/product-media';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { ownWholesaler } from './own-wholesaler';
import {
  WHOLESALER_PRODUCT_EXAMPLE,
  WHOLESALER_PRODUCTS_PAGE_EXAMPLE,
} from './wholesaler.examples';

/**
 * BE-30 (OPT-2, NRX-2): optovik mahsulot taklif qiladi — admin tasdiqlamaguncha sotuvga chiqmaydi (PENDING_REVIEW);
 * shartnomasiz — 403 (TC1). Narx hisobi faqat o‘z mahsulotiga (TC6); boshqa optovikniki — 403.
 */
@ApiTags('wholesaler')
@ApiBearerAuth()
@Roles(Role.WHOLESALER)
@Controller('wholesaler/products')
export class WholesalerProductsController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.FILE) private readonly files: ClientProxy,
  ) {}

  @Post('media')
  // bir IP (mobil operator NAT i) ortida bir necha optovik bo‘lishi mumkin [taklif]
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Mahsulot rasmini taklifdan oldin yuklash (FE-23, OPT-2)',
    description:
      'JPEG, PNG, WEBP, 10 MB gacha. Qaytgan `url` taklifning `images` maydoniga yuboriladi.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(PRODUCT_MEDIA_BODY)
  @ApiCreatedResponse({ type: ProductMediaDto })
  @ApiBadRequestResponse({
    description: 'FILE_REQUIRED — fayl yo‘q; FILE_TYPE_INVALID — tur mos emas',
  })
  @ApiPayloadTooLargeResponse({
    description: 'FILE_TOO_LARGE — 10 MB dan katta',
  })
  @ApiForbiddenResponse({
    description:
      'Optovik yozuvi yoki komissiya shartnomasi yo‘q, rad etilgan yoki to‘xtatilgan',
  })
  @UseInterceptors(
    FileTooLargeInterceptor,
    FileInterceptor('file', PRODUCT_MEDIA_OPTIONS),
  )
  async media(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtUser,
  ): Promise<ProductMediaDto> {
    // rasm ochiq papkaga tushadi — faqat mahsulot taklif qila oladigan optovikka
    const wholesaler = await ownWholesaler(this.catalog, user);
    if (
      !wholesaler.contractNumber ||
      !wholesaler.contractDate ||
      ![ShopStatus.ACTIVE, ShopStatus.PENDING].includes(wholesaler.status)
    )
      throw new ForbiddenException(
        'Mahsulot taklifi yopiq: shartnoma yo‘q yoki optovik to‘xtatilgan',
      );
    return storeProductMedia(this.files, file);
  }

  @Post()
  @ApiOperation({
    summary:
      'Mahsulot taklifi: nom, tavsif, rasm, og‘irlik va o‘lcham, bazaviy narx (sertifikat — /wholesaler/documents)',
  })
  @ApiCreatedResponse({
    description:
      'Taklif qilingan mahsulot — admin tasdig‘igacha PENDING_REVIEW (sotuvga chiqmaydi)',
    schema: { example: WHOLESALER_PRODUCT_EXAMPLE },
  })
  @ApiForbiddenResponse({
    description:
      'Komissiya shartnomasi yo‘q yoki optovik rad etilgan/to‘xtatilgan',
  })
  create(@Body() dto: CreateProductDto, @CurrentUser() user: JwtUser) {
    return sendRpc(
      this.catalog,
      { cmd: RPC.PRODUCT_CREATE },
      { ownerUserId: user.sub, dto },
    );
  }

  @Get()
  @ApiOperation({
    summary: 'O‘z mahsulotlarim (holat va admin izohi bilan)',
  })
  @ApiOkResponse({
    description: 'Yangisi tepada; rad etilganda sababi `moderationNote` da',
    schema: { example: WHOLESALER_PRODUCTS_PAGE_EXAMPLE },
  })
  list(
    @Query() query: WholesalerProductsQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: RPC.PRODUCT_LIST },
      { ownerUserId: user.sub, query },
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Mahsulot kartasi' })
  @ApiOkResponse({ schema: { example: WHOLESALER_PRODUCT_EXAMPLE } })
  @ApiForbiddenResponse({ description: 'Boshqa optovikning mahsuloti' })
  @ApiNotFoundResponse({ description: 'Mahsulot topilmadi' })
  get(@Param('id', ParseLeadIdPipe) id: string, @CurrentUser() user: JwtUser) {
    return sendRpc(
      this.catalog,
      { cmd: RPC.PRODUCT_GET },
      { ownerUserId: user.sub, productId: id },
    );
  }

  @Get(':id/pricing')
  @ApiOperation({
    summary:
      'Narx hisobi (NRX-2): tavsiya narx, zararsizlik, qat’iy pastki chegara, taqsimot, platforma natijasi',
  })
  @ApiOkResponse({
    description:
      '`calculation` — narx hisobi, `evaluation` — narx bahosi: so‘ralgan `price`, bo‘lmasa tasdiqlangan narx, u ham bo‘lmasa tavsiya narx bo‘yicha; ichki siyosat va Elchi tarifi berilmaydi',
    schema: { example: WHOLESALER_PRICING_EXAMPLE },
  })
  @ApiForbiddenResponse({ description: 'Boshqa optovikning mahsuloti' })
  @ApiNotFoundResponse({ description: 'Mahsulot topilmadi' })
  pricing(
    @Param('id', ParseLeadIdPipe) id: string,
    @Query() query: WholesalerPricingQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: RPC.PRICING },
      { ownerUserId: user.sub, productId: id, query },
    );
  }
}
