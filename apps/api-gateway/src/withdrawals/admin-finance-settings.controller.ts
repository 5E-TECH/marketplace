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
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  CurrentUser,
  FINANCE_SETTINGS_RPC,
  FinanceSettingKey,
  FinanceSettingSetResult,
  FinanceSettingStateDto,
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
      },
    );
    // TC1: kim (actor), qachon (yozuv vaqti), eski va yangi qiymat, kuchga kirish va izoh
    await sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: user.sub,
        action: 'finance.setting.update',
        entityType: 'FinanceSetting',
        entityId: key,
        meta: {
          before: result.before,
          after: result.after,
          effectiveFrom: result.effectiveFrom,
          comment: dto.comment,
          ip: ip ?? null,
        },
      },
    ).catch((error: Error) =>
      // sozlama saqlangan — audit yozilmasa ham javob qaytadi, lekin logda qoladi
      this.logger.error(
        `Audit yozilmadi (finance.setting.update ${key}): ${error.message}`,
      ),
    );
    return result;
  }
}
