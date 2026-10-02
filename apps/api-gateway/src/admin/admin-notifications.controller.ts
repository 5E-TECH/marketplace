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
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  BroadcastDto,
  BroadcastPreviewDto,
  BroadcastPreviewResultDto,
  BroadcastSendDto,
  BroadcastsPageDto,
  BroadcastsQueryDto,
  CurrentUser,
  JwtUser,
  NotificationTemplateDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  UpdateNotificationTemplateDto,
} from '@app/common';

/**
 * C6.8 — xabar shablonlari va ommaviy xabar. Shablonni ADMIN ham tahrirlaydi;
 * ommaviy xabarni faqat SUPERADMIN ko'radi va yuboradi (kuchli qurol —
 * qaytarib bo'lmaydi). Har o'zgartiruvchi amal auditga yoziladi.
 */
@ApiTags('admin-notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
@ApiForbiddenResponse({ type: AuthErrorResponseDto })
@Controller('admin')
export class AdminNotificationsController {
  constructor(
    @Inject(RmqClient.NOTIFICATION) private readonly notifications: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get('notifications/templates')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Avtomatik xabar shablonlari' })
  @ApiOkResponse({ type: [NotificationTemplateDto] })
  templates() {
    return sendRpc(
      this.notifications,
      { cmd: 'notification.admin.templates.list' },
      {},
    );
  }

  @Patch('notifications/templates/:key')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Shablonni tahrirlash',
    description:
      'Faqat shablon `variables` ro‘yxatidagi `{nomi}` o‘zgaruvchilari; ' +
      'boshqasi 400. Keyingi xabardan boshlab ishlatiladi.',
  })
  @ApiOkResponse({ type: NotificationTemplateDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  async updateTemplate(
    @Param('key') key: string,
    @Body() dto: UpdateNotificationTemplateDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.notifications,
      { cmd: 'notification.admin.templates.update' },
      { key, dto, actorId: admin.sub },
    );
    this.audit(
      admin.sub,
      'notification.template.update',
      'NotificationTemplate',
      key,
      ip,
      dto,
    );
    return result;
  }

  @Post('notifications/templates/:key/reset')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Shablonni standart matnga qaytarish' })
  @ApiOkResponse({ type: NotificationTemplateDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  async resetTemplate(
    @Param('key') key: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.notifications,
      { cmd: 'notification.admin.templates.reset' },
      { key },
    );
    this.audit(
      admin.sub,
      'notification.template.reset',
      'NotificationTemplate',
      key,
      ip,
      {},
    );
    return result;
  }

  @Post('broadcast/preview')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Ommaviy xabarni oldindan ko‘rish',
    description:
      'Qabul qiluvchilar sonini va `previewToken` ni qaytaradi. Hech narsa yuborilmaydi.',
  })
  @ApiOkResponse({ type: BroadcastPreviewResultDto })
  preview(@Body() dto: BroadcastPreviewDto) {
    return sendRpc(
      this.notifications,
      { cmd: 'notification.admin.broadcast.preview' },
      { dto },
    );
  }

  @Post('broadcast')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Ommaviy xabar yuborish (faqat SUPERADMIN)',
    description:
      'Faqat `preview` bergan token bilan: xabar yoki qabul qiluvchilar soni ' +
      'o‘zgargan bo‘lsa 409. Bir xil token ikkinchi marta yubormaydi ' +
      '(`idempotent: true`). Yuborish fonda — holati `GET /admin/broadcasts` da.',
  })
  @ApiAcceptedResponse({ type: BroadcastDto })
  @ApiConflictResponse({ type: AuthErrorResponseDto })
  async send(
    @Body() dto: BroadcastSendDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc<BroadcastDto>(
      this.notifications,
      { cmd: 'notification.admin.broadcast.send' },
      { dto, actorId: admin.sub },
    );
    if (!result.idempotent) {
      this.audit(
        admin.sub,
        'notification.broadcast.send',
        'Broadcast',
        result.id,
        ip,
        {
          audience: dto.audience,
          channels: dto.channels ?? [],
          title: dto.title,
          recipientsCount: result.recipientsCount,
        },
      );
    }
    return result;
  }

  @Get('broadcasts')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Ommaviy xabarlar tarixi va yuborish holati' })
  @ApiOkResponse({ type: BroadcastsPageDto })
  broadcasts(@Query() query: BroadcastsQueryDto) {
    return sendRpc(
      this.notifications,
      { cmd: 'notification.admin.broadcasts.list' },
      { query },
    );
  }

  private audit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    ip: string,
    meta: object,
  ) {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action,
        entityType,
        entityId,
        meta: { ...meta, ip: ip || null },
      },
    ).catch(() => undefined);
  }
}
