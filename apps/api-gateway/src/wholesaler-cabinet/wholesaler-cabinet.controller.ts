import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CompleteWholesalerProfileDto,
  ConfirmWholesalerDocumentDto,
  CurrentUser,
  JwtUser,
  PrivateFileVerified,
  PrivateUploadPolicyDto,
  PrivateUploadPolicyResultDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  ShopStatus,
  SignedLinkDto,
  WHOLESALER_CABINET_RPC as RPC,
  WholesalerDashboardDto,
  WholesalerDocumentDto,
  WholesalerDocumentRecord,
  WholesalerMoneyDto,
  WholesalerProfileDto,
  WholesalerSoldUnit,
  WholesalerStockRowDto,
  WholesalerStockTotals,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { ownWholesaler } from './own-wholesaler';
import { SignedLinkService } from './signed-link';

/**
 * BE-30 (TZ 6.9 OPT-1, OPT-3): optovik kabineti — profil (rekvizitlar, shartnoma), panel (ombor va pul), yopiq
 * hujjatlar. Optovik JWT foydalanuvchisidan aniqlanadi; boshqa optovikning hujjati — 403.
 */
@ApiTags('wholesaler')
@ApiBearerAuth()
@Roles(Role.WHOLESALER)
@Controller('wholesaler')
export class WholesalerCabinetController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    @Inject(RmqClient.FILE) private readonly files: ClientProxy,
    private readonly links: SignedLinkService,
  ) {}

  @Get('profile')
  @ApiOperation({
    summary:
      'Optovik profili: rekvizitlar, holat (PENDING — admin ko‘rmoqda), shartnoma',
  })
  @ApiOkResponse({ type: WholesalerProfileDto })
  @ApiNotFoundResponse({
    description: 'Optovik yozuvi yo‘q — POST /wholesaler/profile',
  })
  profile(@CurrentUser() user: JwtUser): Promise<WholesalerProfileDto> {
    return sendRpc(this.catalog, { cmd: RPC.ME }, { ownerUserId: user.sub });
  }

  @Post('profile')
  @ApiOperation({
    summary:
      'Ro‘yxatni yakunlash yoki rad etilgan arizani qayta yuborish: rekvizitlar, shartnoma va rozilik (boshqa holatda yozuv o‘zgarmaydi)',
  })
  @ApiCreatedResponse({ type: WholesalerProfileDto })
  @ApiOkResponse({ type: WholesalerProfileDto })
  async complete(
    @Body() dto: CompleteWholesalerProfileDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<WholesalerProfileDto> {
    const accepted = await sendRpc<{ contractVersion: string }>(
      this.identity,
      { cmd: RPC.ACCEPT_DOCUMENTS },
      {
        userId: user.sub,
        contractVersion: dto.contractVersion,
        consentVersion: dto.consentVersion,
        ip: ip ?? null,
      },
    );
    const me = await sendRpc<{ phone?: string | null }>(
      this.identity,
      { cmd: 'auth.me' },
      { userId: user.sub },
    );
    const { free } = await sendRpc<{ free: boolean }>(
      this.catalog,
      { cmd: RPC.TIN_FREE },
      { tin: dto.tin },
    );
    const existing = await sendRpc<WholesalerProfileDto>(
      this.catalog,
      { cmd: RPC.ME },
      { ownerUserId: user.sub },
    ).catch((e: unknown) => {
      if (e instanceof HttpException && e.getStatus() === 404) return null;
      throw e;
    });
    // rad etilgan ariza — yangi rekvizitlar bilan qayta yuboriladi (catalog yana PENDING qiladi)
    if (existing && existing.status !== ShopStatus.REJECTED) return existing;
    if (!free)
      throw new ConflictException('Bu STIR bilan optovik allaqachon bor');
    return sendRpc(
      this.catalog,
      { cmd: RPC.SELF_REGISTER },
      {
        ...dto,
        ownerUserId: user.sub,
        phone: me.phone ?? null,
        contractVersion: accepted.contractVersion,
      },
    );
  }

  @Get('dashboard')
  @ApiOperation({
    summary:
      'Panel (OPT-3): mahsulotlar bo‘yicha omborda, bandda, yo‘lda (postavka), mijozga yo‘lda, sotilgan (moliyadan), qaytgan, brak; pul holati',
  })
  @ApiOkResponse({ type: WholesalerDashboardDto })
  async dashboard(
    @CurrentUser() user: JwtUser,
  ): Promise<WholesalerDashboardDto> {
    const wholesaler = await ownWholesaler(this.catalog, user);
    const variants = await sendRpc<
      Array<
        Pick<
          WholesalerStockRowDto,
          'productId' | 'productName' | 'variantId' | 'sku'
        >
      >
    >(this.catalog, { cmd: RPC.VARIANTS }, { wholesalerId: wholesaler.id });
    // «Sotilgan» moliya hisobidan (pul bilan bir hisob) — ombor qolgan raqamlarni shu son bilan hisoblaydi
    const [sold, money] = await Promise.all([
      sendRpc<WholesalerSoldUnit[]>(
        this.finance,
        { cmd: RPC.SOLD_UNITS },
        { wholesalerId: wholesaler.id },
      ),
      sendRpc<WholesalerMoneyDto>(
        this.finance,
        { cmd: RPC.BALANCE },
        { wholesalerId: wholesaler.id },
      ),
    ]);
    const stock = await sendRpc<{
      items: WholesalerStockRowDto[];
      totals: WholesalerStockTotals;
    }>(
      this.inventory,
      { cmd: RPC.STOCK_SUMMARY },
      { wholesalerId: wholesaler.id, variants, sold },
    );
    return { stock: stock.items, stockTotals: stock.totals, money };
  }

  // ------------------------------------------------------------------ shartnoma

  @Post('contract/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Elektron komissiya shartnomasi PDF — 10 daqiqalik imzolangan havola (TC4)',
  })
  @ApiOkResponse({ type: SignedLinkDto })
  @ApiForbiddenResponse({ description: 'Optovik yozuvi yo‘q' })
  async contractLink(@CurrentUser() user: JwtUser): Promise<SignedLinkDto> {
    const wholesaler = await ownWholesaler(this.catalog, user);
    if (!wholesaler.contractVersion)
      throw new ConflictException(
        'Elektron shartnoma yo‘q — shartnoma qog‘ozda (admin kiritgan)',
      );
    return this.links.sign({ t: 'contract', w: wholesaler.id });
  }

  // ------------------------------------------------------------------ yopiq hujjatlar

  @Post('documents/upload-policy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Hujjat yuklash (KYC, sertifikat): imzolangan POST — fayl yopiq joyga, PDF/JPEG/PNG, 10 MB gacha',
  })
  @ApiOkResponse({ type: PrivateUploadPolicyResultDto })
  async uploadPolicy(
    @Body() dto: PrivateUploadPolicyDto,
    @CurrentUser() user: JwtUser,
  ): Promise<PrivateUploadPolicyResultDto> {
    const wholesaler = await ownWholesaler(this.catalog, user);
    return sendRpc(
      this.files,
      { cmd: RPC.PRIVATE_UPLOAD_POLICY },
      {
        wholesalerId: wholesaler.id,
        contentType: dto.contentType,
        size: dto.size,
      },
    );
  }

  @Post('documents')
  @ApiOperation({
    summary:
      'Yuklangan hujjatni tasdiqlash: tur va tarkib tekshiriladi, yopiq joyga ko‘chiriladi, yozuv ochiladi',
  })
  @ApiCreatedResponse({ type: WholesalerDocumentDto })
  async confirmDocument(
    @Body() dto: ConfirmWholesalerDocumentDto,
    @CurrentUser() user: JwtUser,
  ): Promise<WholesalerDocumentDto> {
    const wholesaler = await ownWholesaler(this.catalog, user);
    const file = await sendRpc<PrivateFileVerified>(
      this.files,
      { cmd: RPC.PRIVATE_VERIFY },
      { wholesalerId: wholesaler.id, objectKey: dto.objectKey },
    );
    const record = await sendRpc<WholesalerDocumentRecord>(
      this.catalog,
      { cmd: RPC.DOCUMENT_ADD },
      {
        ownerUserId: user.sub,
        kind: dto.kind,
        productId: dto.productId ?? null,
        objectKey: file.objectKey,
        fileName: dto.fileName,
        contentType: file.contentType,
        size: file.size,
      },
    );
    return publicDocument(record);
  }

  @Get('documents')
  @ApiOperation({ summary: 'O‘z hujjatlarim' })
  @ApiOkResponse({ type: [WholesalerDocumentDto] })
  async documents(
    @CurrentUser() user: JwtUser,
  ): Promise<WholesalerDocumentDto[]> {
    const wholesaler = await ownWholesaler(this.catalog, user);
    const rows = await sendRpc<WholesalerDocumentRecord[]>(
      this.catalog,
      { cmd: RPC.DOCUMENT_LIST },
      { wholesalerId: wholesaler.id },
    );
    return rows.map(publicDocument);
  }

  @Post('documents/:id/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hujjatga 10 daqiqalik imzolangan havola' })
  @ApiOkResponse({ type: SignedLinkDto })
  @ApiForbiddenResponse({ description: 'Boshqa optovikning hujjati' })
  async documentLink(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() user: JwtUser,
  ): Promise<SignedLinkDto> {
    const wholesaler = await ownWholesaler(this.catalog, user);
    const doc = await sendRpc<WholesalerDocumentRecord>(
      this.catalog,
      { cmd: RPC.DOCUMENT_GET },
      { id },
    );
    if (doc.wholesalerId !== wholesaler.id)
      throw new ForbiddenException('Boshqa optovikning hujjati');
    return this.links.sign({ t: 'doc', id: doc.id });
  }
}

/** Saqlash kaliti tashqariga chiqmaydi. */
export function publicDocument(
  record: WholesalerDocumentRecord,
): WholesalerDocumentDto {
  const { objectKey: _objectKey, ...rest } = record;
  void _objectKey;
  return rest;
}
