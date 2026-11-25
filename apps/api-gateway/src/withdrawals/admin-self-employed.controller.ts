import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Logger,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  AffiliateDocumentFile,
  CurrentUser,
  JwtUser,
  openPinfl,
  PinflDto,
  pinflKey,
  RejectSelfEmployedDto,
  RevokeSelfEmployedDto,
  RmqClient,
  Role,
  Roles,
  SELF_EMPLOYED_RPC,
  SelfEmployedDetailDto,
  SelfEmployedListQueryDto,
  SelfEmployedPageDto,
  sendRpc,
} from '@app/common';
import { sendPrivateFile } from '../affiliate-account/private-file-response';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { currentFullName, recheckOnNameChange } from './name-recheck';

/**
 * BE-25 5-tur (ega, 2026-11-25; P-A5): moliya sotuvchining o‘zini o‘zi band qilganlik arizasini qo‘lda tekshiradi.
 * Ko‘rish — ADMIN, FINANCE, SUPERADMIN; to‘liq JShShIR, hujjat va qaror — FINANCE, SUPERADMIN. To‘liq raqam va hujjat
 * ochilishi AVVAL auditga yoziladi — yozilmasa ochilmaydi.
 */
@ApiTags('admin-finance')
@ApiBearerAuth()
@Controller('admin/finance/self-employed')
export class AdminSelfEmployedController {
  private readonly logger = new Logger(AdminSelfEmployedController.name);

  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    @Inject(RmqClient.FILE) private readonly files: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'JShShIR arizalari: har sotuvchining oxirgisi, tekshiriladiganlari eskisi tepada; holatlar soni bilan',
  })
  @ApiOkResponse({ type: SelfEmployedPageDto })
  list(@Query() query: SelfEmployedListQueryDto): Promise<SelfEmployedPageDto> {
    return sendRpc(this.finance, { cmd: SELF_EMPLOYED_RPC.LIST }, { query });
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Ariza: mavjud pul (tasdiqni kutayotgan to‘lov) va shu JShShIR bilan boshqa sotuvchilar',
  })
  @ApiOkResponse({ type: SelfEmployedDetailDto })
  @ApiNotFoundResponse({ description: 'Ariza topilmadi' })
  get(
    @Param('id', ParseLeadIdPipe) id: string,
  ): Promise<SelfEmployedDetailDto> {
    return sendRpc(this.finance, { cmd: SELF_EMPLOYED_RPC.GET }, { id });
  }

  @Post(':id/reveal')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'To‘liq JShShIR (soliq ro‘yxatida tekshirish uchun) — auditga yoziladi',
  })
  @ApiOkResponse({ type: PinflDto })
  @ApiNotFoundResponse({ description: 'Ariza yoki JShShIR yo‘q' })
  @ApiConflictResponse({
    description: 'Ariza eskirgan yoki shifr kaliti almashgan',
  })
  async reveal(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PinflDto> {
    const key = pinflKey(this.config);
    const { affiliateId } = await this.get(id);
    await this.mustAudit(user, 'self-employed.reveal', id, affiliateId, ip);
    const { pinflSealed } = await sendRpc<{ pinflSealed: string }>(
      this.finance,
      { cmd: SELF_EMPLOYED_RPC.REVEAL },
      { id },
    );
    const pinfl = openPinfl(pinflSealed, key);
    if (!pinfl)
      throw new ConflictException(
        'JShShIR ochilmadi — shifr kaliti almashgan; arizani rad eting, sotuvchi qayta yuboradi',
      );
    res.setHeader('Cache-Control', 'private, no-store');
    return { pinfl };
  }

  @Get(':id/document')
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Arizadagi ma’lumotnoma — auditga yoziladi' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiNotFoundResponse({ description: 'Ariza yoki hujjat yo‘q' })
  async document(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { affiliateId } = await this.get(id);
    const document = await sendRpc<AffiliateDocumentFile>(
      this.finance,
      { cmd: SELF_EMPLOYED_RPC.DOCUMENT },
      { id },
    );
    await this.mustAudit(user, 'self-employed.document', id, affiliateId, ip);
    return sendPrivateFile(this.files, res, document);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Maqomni tasdiqlash — pul yechish ochiladi' })
  @ApiOkResponse({ type: SelfEmployedDetailDto })
  @ApiConflictResponse({
    description:
      'Ariza tekshiruvda emas yoki eskirgan; NAME_CHANGED — profildagi ism arizadagidan farq qiladi, ariza hozirgi ism bilan yangilandi (navbatdan qayta oching)',
  })
  async approve(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<SelfEmployedDetailDto> {
    const { affiliateId } = await this.get(id);
    const fullName = await currentFullName(this.identity, affiliateId);
    const result = await recheckOnNameChange(
      this.finance,
      affiliateId,
      fullName,
      () =>
        sendRpc<SelfEmployedDetailDto>(
          this.finance,
          { cmd: SELF_EMPLOYED_RPC.APPROVE },
          { id, reviewerId: user.sub, currentFullName: fullName },
        ),
    );
    this.audit(user, 'self-employed.approve', result, ip);
    return result;
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Rad etish — sabab majburiy, sabab va izoh sotuvchiga ko‘rinadi',
  })
  @ApiOkResponse({ type: SelfEmployedDetailDto })
  @ApiConflictResponse({ description: 'Ariza tekshiruvda emas' })
  async reject(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: RejectSelfEmployedDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<SelfEmployedDetailDto> {
    const result = await sendRpc<SelfEmployedDetailDto>(
      this.finance,
      { cmd: SELF_EMPLOYED_RPC.REJECT },
      { id, reviewerId: user.sub, reason: dto.reason, comment: dto.comment },
    );
    this.audit(user, 'self-employed.reject', result, ip);
    return result;
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Tasdiqlangan maqomni bekor qilish — pul yechish yopiladi',
  })
  @ApiOkResponse({ type: SelfEmployedDetailDto })
  @ApiConflictResponse({ description: 'Maqom tasdiqlangan emas' })
  async revoke(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: RevokeSelfEmployedDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<SelfEmployedDetailDto> {
    const result = await sendRpc<SelfEmployedDetailDto>(
      this.finance,
      { cmd: SELF_EMPLOYED_RPC.REVOKE },
      { id, reviewerId: user.sub, reason: dto.reason, comment: dto.comment },
    );
    this.audit(user, 'self-employed.revoke', result, ip);
    return result;
  }

  /** Shaxsiy ma’lumot ochilishi — audit yozilmasa 503. */
  private async mustAudit(
    user: JwtUser,
    action: string,
    id: string,
    affiliateId: string,
    ip: string,
  ): Promise<void> {
    try {
      await this.write(user, action, id, {
        affiliateId,
        role: user.role,
        ip: ip ?? null,
      });
    } catch {
      throw new ServiceUnavailableException(
        'Audit yozilmadi — hozir ochilmaydi, qayta urinib ko‘ring',
      );
    }
  }

  private audit(
    user: JwtUser,
    action: string,
    row: SelfEmployedDetailDto,
    ip: string,
  ): void {
    void this.write(user, action, row.id, {
      affiliateId: row.affiliateId,
      status: row.status,
      reason: row.reason,
      comment: row.comment,
      ip: ip ?? null,
    }).catch((error: Error) =>
      this.logger.warn(`${action} auditga yozilmadi: ${error.message}`),
    );
  }

  private write(
    user: JwtUser,
    action: string,
    entityId: string,
    meta: Record<string, unknown>,
  ): Promise<unknown> {
    return sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      { actorId: user.sub, action, entityType: 'SelfEmployed', entityId, meta },
    );
  }
}
