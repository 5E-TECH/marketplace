import {
  Body,
  Controller,
  Get,
  Inject,
  Ip,
  Logger,
  Param,
  ParseEnumPipe,
  Put,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  AFFILIATE_AUTH_RPC,
  AuthErrorResponseDto,
  CurrentUser,
  IgnoreAuthCookie,
  JwtUser,
  LegalDocumentDto,
  LegalDocumentType,
  Public,
  PublishLegalDocumentDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';
import { LabelDocument, labelPdf } from '../orders/label-pdf';

/**
 * BE-06 (SOT-1, FE-04): sotuvchi ofertasi va shaxsiy ma’lumotlarga rozilik matni. Ro‘yxat oferta qadamida o‘qiladi —
 * kirishsiz ochiq. Matnni yurist beradi (EQ-10), superadmin yangi versiyani e’lon qiladi.
 */
@ApiTags('legal')
@Controller()
export class LegalDocumentsController {
  private readonly logger = new Logger(LegalDocumentsController.name);

  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Public()
  @IgnoreAuthCookie()
  @Get('legal/documents/:type')
  @ApiOperation({
    summary: 'Hujjatning joriy versiyasi (effectiveAt null — «e’lon qilinadi»)',
  })
  @ApiParam({ name: 'type', enum: LegalDocumentType })
  @ApiOkResponse({ type: LegalDocumentDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  get(
    @Param('type', new ParseEnumPipe(LegalDocumentType))
    type: LegalDocumentType,
  ): Promise<LegalDocumentDto> {
    return sendRpc(
      this.identity,
      { cmd: AFFILIATE_AUTH_RPC.LEGAL_GET },
      { type },
    );
  }

  @Public()
  @IgnoreAuthCookie()
  @Get('legal/documents/:type/pdf')
  @ApiOperation({
    summary: 'Hujjatning joriy versiyasi PDF da (e’lon qilingan matn)',
  })
  @ApiParam({ name: 'type', enum: LegalDocumentType })
  @ApiProduces('application/pdf')
  @ApiNotFoundResponse({
    description: 'Hujjat matni hali e’lon qilinmagan',
    type: AuthErrorResponseDto,
  })
  async pdf(
    @Param('type', new ParseEnumPipe(LegalDocumentType))
    type: LegalDocumentType,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pdf = await sendRpc<LabelDocument>(
      this.identity,
      { cmd: AFFILIATE_AUTH_RPC.LEGAL_PDF },
      { type },
    );
    // yangi versiya darhol ko‘rinsin
    res.setHeader('Cache-Control', 'no-cache');
    return labelPdf(res, pdf);
  }

  @Put('admin/legal/documents/:type')
  @Roles(Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Yangi versiyani e’lon qilish (matn — yurist); sotuvchilar keyingi kirishda qabul qiladi',
  })
  @ApiParam({ name: 'type', enum: LegalDocumentType })
  @ApiOkResponse({ type: LegalDocumentDto })
  @ApiConflictResponse({ description: 'Bu versiya allaqachon e’lon qilingan' })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async publish(
    @Param('type', new ParseEnumPipe(LegalDocumentType))
    type: LegalDocumentType,
    @Body() dto: PublishLegalDocumentDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<LegalDocumentDto> {
    const doc = await sendRpc<LegalDocumentDto>(
      this.identity,
      { cmd: AFFILIATE_AUTH_RPC.LEGAL_PUBLISH },
      { type, dto, actorId: user.sub },
    );
    await sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: user.sub,
        action: 'legal.document.publish',
        entityType: 'LegalDocument',
        entityId: `${type}@${dto.version}`,
        meta: { effectiveAt: dto.effectiveAt ?? null, ip: ip ?? null },
      },
    ).catch((error: Error) =>
      this.logger.error(
        `Audit yozilmadi (legal.document.publish): ${error.message}`,
      ),
    );
    return doc;
  }
}
