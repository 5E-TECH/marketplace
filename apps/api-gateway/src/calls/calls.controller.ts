import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CALL_RPC,
  CallListQueryDto,
  CallPageDto,
  CurrentUser,
  JwtUser,
  RecordingAccess,
  RecordingLinkRequestDto,
  RecordingMode,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  SignedLinkDto,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { RecordingLinkService } from './recording-link';

const DENIED: Record<string, string> = {
  NOT_OWNER: 'Faqat o‘z qo‘ng‘irog‘ingiz yozuvini tinglay olasiz',
  DOWNLOAD_FORBIDDEN: 'Yozuvni yuklab olish faqat admin uchun',
  ROLE: 'Yozuvni tinglash uchun ruxsat yo‘q',
};

/**
 * BE-15 (TEL-3, TEL-7; TZ 3-bo‘lim): qo‘ng‘iroqlar hisoboti va yozuvni tinglash. Operator — faqat o‘z yozuvi, nazoratchi,
 * admin va superadmin — hammasi; yuklab olish faqat admin va superadmin. Har tinglash va har ruxsatsiz urinish auditda
 * (TEL-6, ADM-6).
 */
@ApiTags('calls')
@ApiBearerAuth()
@Controller('calls')
export class CallsController {
  constructor(
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    private readonly links: RecordingLinkService,
  ) {}

  @Get()
  @Roles(Role.SUPERVISOR, Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Qo‘ng‘iroqlar hisoboti (yangisi birinchi)',
    description:
      'Operator, lid, davr (Toshkent) va yozuv holati bo‘yicha. `missingRecordings` va `recording=MISSING` — yozuvsiz qo‘ng‘iroqlar, hisobotda xato (TEL-3).',
  })
  @ApiOkResponse({ type: CallPageDto })
  list(@Query() query: CallListQueryDto): Promise<CallPageDto> {
    return sendRpc(this.lead, { cmd: CALL_RPC.LIST }, { query });
  }

  @Post(':id/recording-link')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.OPERATOR_LEAD, Role.SUPERVISOR, Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Yozuvni tinglash yoki yuklab olish havolasi (vaqtli)',
    description:
      'Audit yozuvi bilan birga beriladi: yozilmasa havola ham berilmaydi. `mode: DOWNLOAD` — faqat admin va superadmin.',
  })
  @ApiOkResponse({ type: SignedLinkDto })
  @ApiForbiddenResponse({
    description: 'Boshqa operatorning yozuvi yoki yuklab olish ruxsati yo‘q',
  })
  @ApiNotFoundResponse({
    description: 'Qo‘ng‘iroq yo‘q; RECORDING_NOT_READY — yozuv yo‘q',
  })
  async recordingLink(
    @Param('id', ParseLeadIdPipe) callId: string,
    @Body() dto: RecordingLinkRequestDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<SignedLinkDto> {
    const mode = dto?.mode ?? RecordingMode.LISTEN;
    const access = await sendRpc<RecordingAccess>(
      this.lead,
      { cmd: CALL_RPC.RECORDING_ACCESS },
      { callId, userId: user.sub, role: user.role, mode },
    );
    const meta = {
      leadId: access.leadId,
      operatorId: access.operatorId,
      role: user.role,
      ip: ip ?? null,
    };
    if (!access.allowed) {
      // rad baribir 403; audit yozilmasa ham ruxsat berilmaydi
      await this.audit(user.sub, 'call.recording.denied', callId, {
        ...meta,
        mode,
        reason: access.reason,
      }).catch(() => undefined);
      throw new ForbiddenException(DENIED[access.reason]);
    }
    try {
      await this.audit(
        user.sub,
        mode === RecordingMode.DOWNLOAD
          ? 'call.recording.download'
          : 'call.recording.listen',
        callId,
        meta,
      );
    } catch {
      throw new ServiceUnavailableException(
        'Audit yozilmadi — yozuv hozir ochilmaydi, qayta urinib ko‘ring',
      );
    }
    return this.links.sign({ callId, mode });
  }

  private audit(
    actorId: string,
    action: string,
    entityId: string,
    meta: Record<string, unknown>,
  ): Promise<unknown> {
    return sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      { actorId, action, entityType: 'Call', entityId, meta },
    );
  }
}
