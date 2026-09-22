import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Ip,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  BannerDto,
  CreateBannerDto,
  CurrentUser,
  DeleteBannerResultDto,
  JwtUser,
  ReorderBannersDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UpdateBannerDto,
} from '@app/common';

/**
 * C6.9 — storefront bosh sahifasidagi reklama bannerlari. Har o'zgarish
 * auditga yoziladi: banner butun platformaga ko'rinadigan kontent.
 */
@ApiTags('admin-content')
@ApiBearerAuth()
@Controller('admin/content/banners')
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class AdminContentController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Barcha bannerlar (nofaol va muddati tugaganlari ham)',
    description:
      '`sortOrder` bo‘yicha tartiblangan. `isVisible` — shu daqiqada ' +
      'storefront’da ko‘rinayotgani.',
  })
  @ApiOkResponse({ type: [BannerDto] })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  list() {
    return sendRpc(this.catalog, { cmd: 'content.banners.admin-list' }, {});
  }

  @Post()
  @ApiOperation({ summary: 'Banner qo‘shish' })
  @ApiCreatedResponse({ type: BannerDto })
  @ApiBadRequestResponse({ description: 'Maydon yoki muddat noto‘g‘ri' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async create(
    @Body() dto: CreateBannerDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const banner = await sendRpc<BannerDto>(
      this.catalog,
      { cmd: 'content.banners.create' },
      dto,
    );
    this.audit(admin.sub, 'banner.create', banner.id, ip, dto);
    return banner;
  }

  // `:id` dan OLDIN turishi shart — aks holda "order" path param sifatida
  // o'qilib, bu route hech qachon ishlamaydi.
  @Patch('order')
  @ApiOperation({
    summary: 'Bannerlar tartibini o‘zgartirish',
    description:
      'Butun ro‘yxat yangi `sortOrder` bilan yuboriladi. Bannerlardan biri ' +
      'topilmasa hech biri saqlanmaydi.',
  })
  @ApiOkResponse({ type: [BannerDto] })
  @ApiBadRequestResponse({ description: 'Takroriy id yoki bo‘sh ro‘yxat' })
  @ApiNotFoundResponse({ description: 'Bannerlardan biri topilmadi' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async reorder(
    @Body() dto: ReorderBannersDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const banners = await sendRpc<BannerDto[]>(
      this.catalog,
      { cmd: 'content.banners.reorder' },
      dto,
    );
    this.audit(admin.sub, 'banner.reorder', '', ip, dto);
    return banners;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Bannerni tahrirlash (holat va muddat ham)' })
  @ApiOkResponse({ type: BannerDto })
  @ApiBadRequestResponse({ description: 'Maydon yoki muddat noto‘g‘ri' })
  @ApiNotFoundResponse({ description: 'Banner topilmadi' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBannerDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const banner = await sendRpc<BannerDto>(
      this.catalog,
      { cmd: 'content.banners.update' },
      { id, dto },
    );
    this.audit(admin.sub, 'banner.update', id, ip, dto);
    return banner;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Bannerni o‘chirish' })
  @ApiOkResponse({ type: DeleteBannerResultDto })
  @ApiNotFoundResponse({ description: 'Banner topilmadi' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async remove(
    @Param('id') id: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc<DeleteBannerResultDto>(
      this.catalog,
      { cmd: 'content.banners.remove' },
      { id },
    );
    this.audit(admin.sub, 'banner.delete', id, ip, {});
    return result;
  }

  /**
   * Audit "best-effort": identity javob bermasa ham banner amali bajarilgan
   * bo'lib qoladi. `void` qilingan promise'ning rad etilishi ham, sinxron
   * tashlangan xato ham yutiladi — aks holda gateway'da ushlanmagan
   * rejection paydo bo'ladi.
   */
  private audit(
    actorId: string,
    action: string,
    entityId: string,
    ip: string,
    meta: object,
  ) {
    try {
      void sendRpc(
        this.identity,
        { cmd: 'identity.audit.log' },
        {
          actorId,
          action,
          entityType: 'Banner',
          entityId: entityId || null,
          meta: { ...meta, ip: ip || null },
        },
      ).catch(() => undefined);
    } catch {
      // audit yozilmadi — asosiy amal to'xtamaydi
    }
  }
}
