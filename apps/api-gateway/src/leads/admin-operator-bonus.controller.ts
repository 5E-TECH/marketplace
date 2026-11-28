import { Body, Controller, Get, Inject, Ip, Put } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  JwtUser,
  OPERATOR_BONUS_RPC,
  OperatorBonusSettingsDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  UpdateOperatorBonusSettingsDto,
} from '@app/common';

/**
 * BE-45 TC6 (ega qarori 2026-11-28, EQ-14): operatorga upsell bonusi summasi — superadmin sozlamasi.
 * Har qo‘shilgan boshqa tovarga bitta bonus, mijoz tovarni olganda; 0 — hisoblanmaydi. Ish haqi bilan to‘lanadi (TZ 2.5).
 */
@ApiTags('admin-operator-bonus')
@ApiBearerAuth()
@Controller('admin/operator-bonus')
export class AdminOperatorBonusController {
  constructor(
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Upsell bonusi sozlamasi (BE-45)' })
  @ApiOkResponse({ type: OperatorBonusSettingsDto })
  get(): Promise<OperatorBonusSettingsDto> {
    return sendRpc(this.lead, { cmd: OPERATOR_BONUS_RPC.SETTINGS_GET }, {});
  }

  @Put()
  @Roles(Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Upsell bonusi summasini o‘zgartirish (BE-45)',
    description:
      'Yangi summa keyin yetkazilgan buyurtmalarga qo‘llanadi; avval yozilgan bonuslar o‘z summasi bilan qoladi. Audit: ' +
      '`operator-bonus.settings`.',
  })
  @ApiOkResponse({ type: OperatorBonusSettingsDto })
  @ApiBadRequestResponse({ description: 'Summa noto‘g‘ri' })
  async update(
    @CurrentUser() actor: JwtUser,
    @Body() dto: UpdateOperatorBonusSettingsDto,
    @Ip() ip: string,
  ): Promise<OperatorBonusSettingsDto> {
    const before = await sendRpc<OperatorBonusSettingsDto>(
      this.lead,
      { cmd: OPERATOR_BONUS_RPC.SETTINGS_GET },
      {},
    );
    const after = await sendRpc<OperatorBonusSettingsDto>(
      this.lead,
      { cmd: OPERATOR_BONUS_RPC.SETTINGS_SET },
      { actorId: actor.sub, upsellBonus: dto.upsellBonus },
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: actor.sub,
        action: 'operator-bonus.settings',
        entityType: 'OperatorBonusSetting',
        entityId: '1',
        meta: {
          from: before.upsellBonus,
          to: after.upsellBonus,
          ip: ip ?? null,
        },
      },
    ).catch(() => undefined);
    return after;
  }
}
