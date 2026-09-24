/// <reference types="multer" />

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Ip,
  Param,
  Patch,
  Post,
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
  UploadedFileDto,
} from '@app/common';

const MAX_BANNER_IMAGE_SIZE = 5 * 1024 * 1024;
const BANNER_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
    @Inject(RmqClient.FILE) private readonly files: ClientProxy,
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

  /**
   * Banner rasmi. `POST /files/upload` sotuvchi uchun va rasmni mahsulotga
   * biriktiradi, shuning uchun admin undan foydalana olmaydi. Bu endpoint
   * rasmni MinIO'ning ochiq `banners/` papkasiga yuklaydi; qaytgan `url`
   * banner yaratish/tahrirlashda `imageUrl` sifatida yuboriladi.
   */
  @Post('image')
  @ApiOperation({
    summary: 'Banner rasmini yuklash (JPEG/PNG/WEBP, 5 MB gacha)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: UploadedFileDto })
  @ApiBadRequestResponse({ description: 'Fayl yo‘q yoki formati noto‘g‘ri' })
  @ApiPayloadTooLargeResponse({ description: 'Fayl 5 MB dan katta' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_BANNER_IMAGE_SIZE },
      fileFilter: (_request, file, callback) => {
        if (!BANNER_IMAGE_TYPES.has(file.mimetype)) {
          callback(
            new BadRequestException(
              'Faqat JPEG, PNG va WEBP formatlari ruxsat etilgan',
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadedFileDto> {
    if (!file) throw new BadRequestException('Fayl yuborilmadi');
    return sendRpc<UploadedFileDto>(
      this.files,
      { cmd: 'file.upload' },
      {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        base64: file.buffer.toString('base64'),
        folder: 'banners',
      },
    );
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
