import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Param,
  Patch,
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
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AdminCreateProductDto,
  AdminProductsPageDto,
  AdminProductsQueryDto,
  AdminUpdateProductDto,
  CurrentUser,
  HideProductDto,
  JwtUser,
  PRODUCT_ARCHIVE_RPC,
  RejectProductDto,
  ProductDto,
  ProductMediaDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

import { FileTooLargeInterceptor } from '../affiliate-account/affiliate-self-employed.controller';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import {
  PRODUCT_MEDIA_BODY,
  PRODUCT_MEDIA_OPTIONS,
  storeProductMedia,
} from './product-media';
import { ProductResultsCache } from './product-results';
import {
  pickFields,
  seesFullView,
  WAREHOUSE_PRODUCT_FIELDS,
} from './warehouse-view';

@ApiTags('admin-products')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/products')
export class AdminProductsController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.FILE) private readonly files: ClientProxy,
    // BE-25 (FE-12): ro‘yxatdagi «Natijalar» (lid statistikasi)
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
  ) {
    this.results = new ProductResultsCache(this.lead);
  }

  private readonly results: ProductResultsCache;

  @Post('media')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Yangi mahsulot rasmini saqlashdan oldin yuklash (FE-25)',
    description:
      'JPEG, PNG, WEBP, 10 MB gacha. Qaytgan `url` mahsulotning `images` maydoniga yuboriladi. Video — mahsulot saqlangach kreativlar orqali (BE-08).',
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
  @UseInterceptors(
    FileTooLargeInterceptor,
    FileInterceptor('file', PRODUCT_MEDIA_OPTIONS),
  )
  media(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ProductMediaDto> {
    return storeProductMedia(this.files, file);
  }

  @Post()
  @ApiOperation({
    summary: 'Admin optovik nomidan mahsulot qo‘shadi (FE-25)',
    description:
      'BE-07: og‘irlik, o‘lchamlar va bazaviy narx majburiy; optovik shartnomasisiz — 409. Holat PENDING_REVIEW: tasdiqlanmaguncha sotuvga chiqmaydi.',
  })
  @ApiCreatedResponse({ type: ProductDto })
  async create(
    @Body() dto: AdminCreateProductDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const product = await sendRpc<ProductDto>(
      this.catalog,
      { cmd: 'catalog.product.admin-create' },
      { dto },
    );
    this.audit(admin.sub, 'product.create', product.id, ip, {
      wholesalerId: dto.wholesalerId,
    });
    return product;
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Mahsulotni tahrirlash: CPA maydonlari, BAD va CPA belgilari (BE-07)',
  })
  @ApiOkResponse({ type: ProductDto })
  async update(
    @Param('id') id: string,
    @Body() dto: AdminUpdateProductDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const product = await sendRpc<ProductDto>(
      this.catalog,
      { cmd: 'catalog.product.admin-update' },
      { productId: id, dto },
    );
    this.audit(admin.sub, 'product.update', id, ip, { changes: dto });
    return product;
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: 'Mahsulotni tasdiqlash — sotuvga chiqadi (OPT-2, ADM-1)',
  })
  @ApiOkResponse({ type: ProductDto })
  async approve(
    @Param('id') id: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const product = await sendRpc<ProductDto>(
      this.catalog,
      { cmd: 'catalog.product.admin-approve' },
      { productId: id },
    );
    this.audit(admin.sub, 'product.approve', id, ip);
    return product;
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Mahsulotni sabab bilan rad etish (BE-07)' })
  @ApiOkResponse({ type: ProductDto })
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectProductDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const product = await sendRpc<ProductDto>(
      this.catalog,
      { cmd: 'catalog.product.admin-reject' },
      { productId: id, reason: dto.reason },
    );
    this.audit(admin.sub, 'product.reject', id, ip, { reason: dto.reason });
    return product;
  }

  @Get()
  // BE-25 (FE-16, OMB-1): omborchi arizasiz postavkada optovik mahsulotini tanlaydi
  @Roles(Role.ADMIN, Role.WAREHOUSE, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Admin uchun barcha mahsulotlar va moderatsiya filtrlari',
    description:
      'Omborchiga faqat `id`, `shopId`, `name`, `status`, `cpaEnabled`, `isBad`, `isBlocked`, `expiryTracked`, `weightGrams` — narx va sotuvchi haqisiz.',
  })
  @ApiOkResponse({
    description:
      'Optovik rekvizitlari (STIR, bank, shartnoma) berilmaydi. BE-25 (FE-12): qatorda `stock` (HQ), `listPrice`, `hasVideo`, ' +
      '`results` (hamma sotuvchilar, oxirgi 365 kun [taklif]; 5 daqiqa kesh); javob bermagan qism `unavailable` da [taklif]. Omborchiga ' +
      'qo‘shimchalarsiz.',
    type: AdminProductsPageDto,
  })
  @ApiServiceUnavailableResponse({
    description: '`attention` filtri: ombor javob bermadi',
  })
  async list(
    @Query() query: AdminProductsQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    const full = seesFullView(user);
    const [page, results] = await Promise.all([
      sendRpc<{
        items: Array<ProductDto & Record<string, unknown>>;
        unavailable?: string[];
      }>(
        this.catalog,
        { cmd: 'catalog.product.admin-list' },
        { query, extras: full },
      ),
      full ? this.results.get() : Promise.resolve(null),
    ]);
    if (!full) return pickFields(page, WAREHOUSE_PRODUCT_FIELDS);
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        results: results?.get(String(item.id)) ?? null,
      })),
      unavailable: [
        ...(page.unavailable ?? []),
        ...(results ? [] : ['results']),
      ],
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: ProductDto })
  get(@Param('id') id: string) {
    return sendRpc(
      this.catalog,
      { cmd: 'catalog.product.admin-get' },
      { productId: id },
    );
  }

  @Post(':id/suspend')
  @ApiOperation({ summary: 'Mahsulotni to‘xtatish (sotuvdan olinadi)' })
  @ApiCreatedResponse({ type: ProductDto })
  async suspend(
    @Param('id') id: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const product = await sendRpc(
      this.catalog,
      { cmd: 'catalog.product.admin-suspend' },
      { productId: id },
    );
    this.audit(admin.sub, 'product.suspend', id, ip);
    return product;
  }

  @Post(':id/hide')
  @ApiOperation({
    summary: 'Mahsulotni sabab bilan storefront va searchdan yashirish',
  })
  @ApiCreatedResponse({ type: ProductDto })
  async hide(
    @Param('id') id: string,
    @Body() dto: HideProductDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const product = await sendRpc(
      this.catalog,
      { cmd: 'catalog.product.admin-hide' },
      { productId: id, reason: dto.reason },
    );
    this.audit(admin.sub, 'product.hide', id, ip, { reason: dto.reason });
    return product;
  }

  @Post(':id/reactivate')
  @ApiOperation({
    summary: 'To‘xtatilgan yoki yashirilgan mahsulotni qaytarish',
  })
  @ApiCreatedResponse({ type: ProductDto })
  async reactivate(
    @Param('id') id: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const product = await sendRpc(
      this.catalog,
      { cmd: 'catalog.product.admin-reactivate' },
      { productId: id },
    );
    this.audit(admin.sub, 'product.reactivate', id, ip);
    return product;
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mahsulotni arxivlash (FE-25)',
    description:
      'Karta, narx qarorlari va audit saqlanadi; ro‘yxatda «Arxiv» (`status=ARCHIVED`), offer sotuvdan tushadi. ' +
      'Arxivdan chiqarish yo‘q [taklif]. 409: allaqachon arxivda; sotuvdagi (to‘xtatilmagan) mahsulot; omborda yoki ' +
      'bandda dona bor; ochiq buyurtma bor (omborda yoki Elchi’da yakunlanmagan) [taklif]. 503: ombor yoki buyurtma ' +
      'ma’lumoti olinmadi — arxivlanmaydi.',
  })
  @ApiOkResponse({ type: ProductDto })
  @ApiNotFoundResponse({ description: 'Mahsulot topilmadi' })
  @ApiConflictResponse({
    description:
      'Arxivlab bo‘lmaydi: «Mahsulot allaqachon arxivda», «Sotuvdagi mahsulot arxivlanmaydi — avval to‘xtating», ' +
      '«Omborda yoki buyurtmalarda N dona bor …», «Ochiq buyurtmasi bor (N ta) …»',
  })
  async archive(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const product = await sendRpc(
      this.catalog,
      { cmd: PRODUCT_ARCHIVE_RPC.ARCHIVE },
      { productId: id },
    );
    this.audit(admin.sub, 'product.archive', id, ip);
    return product;
  }

  private audit(
    actorId: string,
    action: string,
    entityId: string,
    ip?: string,
    meta: Record<string, unknown> = {},
  ): void {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action,
        entityType: 'Product',
        entityId,
        meta: { ...meta, ip: ip ?? null },
      },
    ).catch(() => undefined);
  }
}
