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
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminCreateProductDto,
  AdminProductsQueryDto,
  AdminUpdateProductDto,
  CurrentUser,
  HideProductDto,
  JwtUser,
  RejectProductDto,
  ProductDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

import { ADMIN_PRODUCTS_PAGE_EXAMPLE } from './admin-m1.examples';

@ApiTags('admin-products')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/products')
export class AdminProductsController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

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
  @ApiOperation({
    summary: 'Admin uchun barcha mahsulotlar va moderatsiya filtrlari',
  })
  @ApiOkResponse({
    description:
      '{ items, total, page, limit, totalPages }; optovik rekvizitlari (STIR, bank, shartnoma) berilmaydi',
    schema: { example: ADMIN_PRODUCTS_PAGE_EXAMPLE },
  })
  list(@Query() query: AdminProductsQueryDto) {
    return sendRpc(
      this.catalog,
      { cmd: 'catalog.product.admin-list' },
      { query },
    );
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
