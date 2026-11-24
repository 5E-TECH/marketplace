import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Ip,
  Logger,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CALL_RPC,
  CurrentUser,
  IDENTITY_USER_NAMES,
  JwtUser,
  OperatorPhoneDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  SetOperatorPhoneDto,
  UserNameRow,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';

/** Ish joyida qo‘ng‘iroq qila oladiganlar (`operator/leads/:id/call` rollari). */
const CALLER_ROLES: readonly Role[] = [
  Role.OPERATOR_LEAD,
  Role.SUPERVISOR,
  Role.SUPERADMIN,
];

/** BE-15: operatorga ichki raqam yoki mobil biriktirish (admin, superadmin). Har o‘zgarish auditda (ADM-6). */
@ApiTags('calls')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/operators')
export class AdminOperatorPhoneController {
  private readonly logger = new Logger(AdminOperatorPhoneController.name);

  constructor(
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get(':id/phone')
  @ApiOperation({ summary: 'Operator telefoni' })
  @ApiOkResponse({ type: OperatorPhoneDto })
  @ApiNotFoundResponse({ description: 'Telefon biriktirilmagan' })
  async get(
    @Param('id', ParseLeadIdPipe) operatorId: string,
  ): Promise<OperatorPhoneDto> {
    const phone = await this.current(operatorId);
    if (!phone) throw new NotFoundException('Telefon biriktirilmagan');
    return phone;
  }

  @Put(':id/phone')
  @ApiOperation({
    summary: 'Operatorga telefon biriktirish',
    description:
      'Faqat operator yoki nazoratchi foydalanuvchiga. Bitta telefon — bitta operator.',
  })
  @ApiOkResponse({ type: OperatorPhoneDto })
  @ApiBadRequestResponse({
    description: 'Raqam noto‘g‘ri yoki foydalanuvchi operator emas',
  })
  @ApiConflictResponse({ description: 'Telefon boshqa operatorda' })
  async set(
    @Param('id', ParseLeadIdPipe) operatorId: string,
    @Body() dto: SetOperatorPhoneDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<OperatorPhoneDto> {
    const [user] = await sendRpc<UserNameRow[]>(
      this.identity,
      { cmd: IDENTITY_USER_NAMES },
      { ids: [operatorId] },
    );
    if (!user || !CALLER_ROLES.includes(user.role))
      throw new BadRequestException(
        'Telefon faqat operator, nazoratchi yoki superadminga biriktiriladi',
      );
    const before = await this.current(operatorId);
    const after = await sendRpc<OperatorPhoneDto>(
      this.lead,
      { cmd: CALL_RPC.PHONE_SET },
      { operatorId, dto, actorId: admin.sub },
    );
    this.audit(admin.sub, 'operator.phone.set', operatorId, ip, {
      before: before && { kind: before.kind, value: before.value },
      after: { kind: after.kind, value: after.value },
    });
    return after;
  }

  @Delete(':id/phone')
  @ApiOperation({
    summary: 'Telefonni olib tashlash',
    description:
      'Operatorda «Qo‘ng‘iroq» tugmasi o‘chadi, natija qo‘lda kiritiladi.',
  })
  @ApiOkResponse({ schema: { example: { deleted: true } } })
  async remove(
    @Param('id', ParseLeadIdPipe) operatorId: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<{ deleted: boolean }> {
    const before = await this.current(operatorId);
    const result = await sendRpc<{ deleted: boolean }>(
      this.lead,
      { cmd: CALL_RPC.PHONE_DELETE },
      { operatorId },
    );
    if (result.deleted)
      this.audit(admin.sub, 'operator.phone.delete', operatorId, ip, {
        before: before && { kind: before.kind, value: before.value },
      });
    return result;
  }

  private current(operatorId: string): Promise<OperatorPhoneDto | null> {
    return sendRpc<OperatorPhoneDto | null>(
      this.lead,
      { cmd: CALL_RPC.PHONE_GET },
      { operatorId },
    );
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
        entityType: 'Operator',
        entityId,
        meta: { ...meta, ip: ip ?? null },
      },
    ).catch((error: Error) =>
      this.logger.error(
        `Audit yozilmadi (${action}, operator ${entityId}): ${error?.message}`,
      ),
    );
  }
}
