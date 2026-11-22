import {
  Body,
  Controller,
  Get,
  Inject,
  Ip,
  Logger,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  CancelFinanceSettingDto,
  CurrentUser,
  FINANCE_SETTINGS_RPC,
  FinanceSettingKey,
  FinanceSettingSetResult,
  FinanceSettingStateDto,
  FinanceSettingValueDto,
  JwtUser,
  Role,
  Roles,
  RmqClient,
  UpdateFinanceSettingDto,
  sendRpc,
} from '@app/common';

/**
 * BE-27 (ADM-2): moliya sozlamalari — rad to‘lovi va minimal yechish, kuchga kirish vaqti va izoh bilan.
 * Sozlamalar ekrani (FE-14) kelguncha superadmin so‘rov bo‘yicha o‘zgartiradi; izohga kim so‘ragani yoziladi.
 */
@ApiTags('admin-finance')
@ApiBearerAuth()
@Controller('admin/finance/settings')
export class AdminFinanceSettingsController {
  private readonly logger = new Logger(AdminFinanceSettingsController.name);

  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get()
  @Roles(Role.FINANCE, Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Moliya sozlamalari: amaldagi, rejalashtirilgan va oldingi qiymatlar',
  })
  @ApiOkResponse({ type: [FinanceSettingStateDto] })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  list(): Promise<FinanceSettingStateDto[]> {
    return sendRpc(this.finance, { cmd: FINANCE_SETTINGS_RPC.LIST }, {});
  }

  @Put(':key')
  @Roles(Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Yangi qiymat (kuchga kirish vaqti bilan); izoh majburiy — auditga',
  })
  @ApiParam({ name: 'key', enum: FinanceSettingKey })
  @ApiOkResponse({
    schema: {
      example: {
        key: 'refusal_fee',
        before: 20000,
        after: 25000,
        effectiveFrom: '2026-12-01T00:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Qiymat yoki vaqt noto‘g‘ri, izoh yo‘q',
  })
  @ApiConflictResponse({ description: 'Shu vaqtga allaqachon kiritilgan' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async set(
    @CurrentUser() user: JwtUser,
    @Param('key', new ParseEnumPipe(FinanceSettingKey)) key: FinanceSettingKey,
    @Body() dto: UpdateFinanceSettingDto,
    @Ip() ip: string,
  ): Promise<FinanceSettingSetResult> {
    const result = await sendRpc<FinanceSettingSetResult>(
      this.finance,
      { cmd: FINANCE_SETTINGS_RPC.SET },
      {
        key,
        value: dto.value,
        effectiveFrom: dto.effectiveFrom,
        actorId: user.sub,
        comment: dto.comment,
      },
    );
    // TC1: kim (actor), qachon (yozuv vaqti), eski va yangi qiymat, kuchga kirish va izoh
    await this.audit(user.sub, 'finance.setting.update', key, {
      before: result.before,
      after: result.after,
      effectiveFrom: result.effectiveFrom,
      comment: dto.comment,
      ip: ip ?? null,
    });
    return result;
  }

  @Post(':key/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Hali kuchga kirmagan rejalashtirilgan qiymatni bekor qilish; izoh majburiy — auditga',
  })
  @ApiParam({ name: 'key', enum: FinanceSettingKey })
  @ApiOkResponse({ type: FinanceSettingValueDto })
  @ApiNotFoundResponse({
    description:
      'Rejalashtirilgan qiymat topilmadi yoki allaqachon kuchga kirgan',
  })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async cancel(
    @CurrentUser() user: JwtUser,
    @Param('key', new ParseEnumPipe(FinanceSettingKey)) key: FinanceSettingKey,
    @Body() dto: CancelFinanceSettingDto,
    @Ip() ip: string,
  ): Promise<FinanceSettingValueDto> {
    const cancelled = await sendRpc<FinanceSettingValueDto>(
      this.finance,
      { cmd: FINANCE_SETTINGS_RPC.CANCEL },
      { key, effectiveFrom: dto.effectiveFrom },
    );
    await this.audit(user.sub, 'finance.setting.cancel', key, {
      cancelled,
      comment: dto.comment,
      ip: ip ?? null,
    });
    return cancelled;
  }

  /**
   * Audit — sozlama saqlangandan keyin (eski/yangi qiymat moliyadan). Bir marta qayta uriniladi; baribir yozilmasa
   * sozlama javobi qaytadi (izoh moliya qatorida saqlangan), xato logda.
   */
  private async audit(
    actorId: string,
    action: string,
    key: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    const payload = {
      actorId,
      action,
      entityType: 'FinanceSetting',
      entityId: key,
      meta,
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await sendRpc(this.identity, { cmd: 'identity.audit.log' }, payload);
        return;
      } catch (error) {
        if (attempt === 2)
          this.logger.error(
            `Audit yozilmadi (${action} ${key}): ${(error as Error).message}`,
          );
      }
    }
  }
}
