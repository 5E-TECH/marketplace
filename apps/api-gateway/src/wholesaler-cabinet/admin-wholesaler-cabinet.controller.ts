import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  JwtUser,
  LinkWholesalerOwnerDto,
  ReviewWholesalerDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  SignedLinkDto,
  WHOLESALER_CABINET_RPC as RPC,
  WholesalerDocumentDto,
  WholesalerDocumentRecord,
  WholesalerProfileDto,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { SignedLinkService } from './signed-link';
import { publicDocument } from './wholesaler-cabinet.controller';

/**
 * BE-30 (OPT-1): admin o‘zi ro‘yxatdan o‘tgan optovikni tasdiqlaydi yoki rad etadi, admin kiritgan optovikka kabinet
 * egasini bog‘laydi (SMS kod bilan kiradi), hujjatlar va elektron shartnomani imzolangan havola bilan ko‘radi.
 * Har amal audit jurnaliga yoziladi (ADM-6).
 */
@ApiTags('admin-wholesalers')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/wholesalers')
export class AdminWholesalerCabinetController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    private readonly links: SignedLinkService,
  ) {}

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'O‘zi ro‘yxatdan o‘tgan optovik: tasdiq (ACTIVE) yoki rad (REJECTED, sabab majburiy)',
  })
  @ApiOkResponse({ type: WholesalerProfileDto })
  @ApiConflictResponse({ description: 'Optovik PENDING holatida emas' })
  async review(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: ReviewWholesalerDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<WholesalerProfileDto> {
    const result = await sendRpc<WholesalerProfileDto>(
      this.catalog,
      { cmd: RPC.REVIEW },
      { ...dto, wholesalerId: id },
    );
    this.audit(admin.sub, 'wholesaler.review', id, ip, {
      decision: dto.decision,
      note: dto.note ?? null,
    });
    return result;
  }

  @Post(':id/owner')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Admin kiritgan optovikka kabinet: shu raqamga optovik foydalanuvchisi (SMS kod bilan kiradi)',
  })
  @ApiOkResponse({ type: WholesalerProfileDto })
  @ApiConflictResponse({
    description:
      'Raqam boshqa foydalanuvchiniki yoki optovikning boshqa egasi bor',
  })
  async linkOwner(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: LinkWholesalerOwnerDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<WholesalerProfileDto> {
    // egasi boshqa bo‘lsa foydalanuvchi yaratilmasin
    const current = await sendRpc<WholesalerProfileDto>(
      this.catalog,
      { cmd: 'catalog.wholesaler.admin-get' },
      { id },
    );
    const { userId } = await sendRpc<{ userId: string }>(
      this.identity,
      { cmd: RPC.ENSURE_USER },
      dto,
    );
    if (current.ownerUserId && current.ownerUserId !== userId)
      throw new ConflictException('Optovikning kabinet egasi allaqachon bor');
    const result = await sendRpc<WholesalerProfileDto>(
      this.catalog,
      { cmd: RPC.LINK_OWNER },
      { wholesalerId: id, ownerUserId: userId },
    );
    this.audit(admin.sub, 'wholesaler.owner.link', id, ip, {
      ownerUserId: userId,
    });
    return result;
  }

  @Get(':id/documents')
  @ApiOperation({ summary: 'Optovik hujjatlari (KYC, sertifikatlar)' })
  @ApiOkResponse({ type: [WholesalerDocumentDto] })
  async documents(
    @Param('id', ParseLeadIdPipe) id: string,
  ): Promise<WholesalerDocumentDto[]> {
    const rows = await sendRpc<WholesalerDocumentRecord[]>(
      this.catalog,
      { cmd: RPC.DOCUMENT_LIST },
      { wholesalerId: id },
    );
    return rows.map(publicDocument);
  }

  @Post(':id/documents/:documentId/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hujjatga 10 daqiqalik imzolangan havola' })
  @ApiOkResponse({ type: SignedLinkDto })
  async documentLink(
    @Param('id', ParseLeadIdPipe) id: string,
    @Param('documentId', ParseLeadIdPipe) documentId: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<SignedLinkDto> {
    const doc = await sendRpc<WholesalerDocumentRecord>(
      this.catalog,
      { cmd: RPC.DOCUMENT_GET },
      { id: documentId },
    );
    if (doc.wholesalerId !== id)
      throw new ForbiddenException('Hujjat bu optovikka tegishli emas');
    this.audit(admin.sub, 'wholesaler.document.link', id, ip, { documentId });
    return this.links.sign({ t: 'doc', id: doc.id });
  }

  @Post(':id/contract/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Elektron komissiya shartnomasi PDF — imzolangan havola',
  })
  @ApiOkResponse({ type: SignedLinkDto })
  async contractLink(
    @Param('id', ParseLeadIdPipe) id: string,
  ): Promise<SignedLinkDto> {
    const wholesaler = await sendRpc<WholesalerProfileDto>(
      this.catalog,
      { cmd: 'catalog.wholesaler.admin-get' },
      { id },
    );
    if (!wholesaler.contractVersion)
      throw new ConflictException(
        'Elektron shartnoma yo‘q — shartnoma qog‘ozda',
      );
    return this.links.sign({ t: 'contract', w: wholesaler.id });
  }

  private audit(
    actorId: string,
    action: string,
    entityId: string,
    ip: string | undefined,
    meta: Record<string, unknown>,
  ): void {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action,
        entityType: 'Wholesaler',
        entityId,
        meta: { ...meta, ip: ip ?? null },
      },
    ).catch(() => undefined);
  }
}
