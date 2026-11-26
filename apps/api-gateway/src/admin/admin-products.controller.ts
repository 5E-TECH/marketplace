import {
  Body,
  Controller,
  Get,
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
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AdminCreateProductDto,
  AdminProductsQueryDto,
  AdminUpdateProductDto,
  CurrentUser,
  HideProductDto,
  JwtUser,
  RejectProductDto,
  ProductDto,
  ProductMediaDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

import { FileTooLargeInterceptor } from '../affiliate-account/affiliate-self-employed.controller';
import {
  PRODUCT_MEDIA_BODY,
  PRODUCT_MEDIA_OPTIONS,
  storeProductMedia,
} from './product-media';
import { ADMIN_PRODUCTS_PAGE_EXAMPLE } from './admin-m1.examples';
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
  ) {}

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
      '{ items, total, page, limit, totalPages }; optovik rekvizitlari (STIR, bank, shartnoma) berilmaydi',
    schema: { example: ADMIN_PRODUCTS_PAGE_EXAMPLE },
  })
  async list(
    @Query() query: AdminProductsQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    const page = await sendRpc<{ items: ProductDto[] }>(
      this.catalog,
      { cmd: 'catalog.product.admin-list' },
      { query },
    );
    return seesFullView(user)
      ? page
      : pickFields(page, WAREHOUSE_PRODUCT_FIELDS);
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
