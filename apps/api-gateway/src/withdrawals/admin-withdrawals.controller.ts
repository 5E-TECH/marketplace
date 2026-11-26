import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Param,
  Post,
  Put,
  Query,
  Logger,
  Optional,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminWithdrawalQueryDto,
  AffiliateSelfEmployedDto,
  CurrentUser,
  ErrorCode,
  FINANCE_WITHDRAWAL_RPC,
  PayoutResultDto,
  RejectWithdrawalDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  SetSelfEmployedDto,
  WithdrawalDto,
  WithdrawalPageDto,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { currentFullName, recheckOnNameChange } from './name-recheck';

/**
 * Moliya: pul yechish so‘rovlari (BE-23; MOL-5, FE-20). Tasdiq, rad va «To‘landi» — moliya xodimi (T01:170);
 * FINANCE va SUPERADMIN (BE-05). Ro‘yxatni ADMIN ham ko‘radi (eski payout kabi).
 */
@ApiTags('admin-finance')
@ApiBearerAuth()
@Controller('admin/finance')
export class AdminWithdrawalsController {
  private readonly logger = new Logger(AdminWithdrawalsController.name);

  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    // BE-24: «Pul o‘tkazildi» SMS i sotuvchiga
    @Optional()
    @Inject(RmqClient.NOTIFICATION)
    private readonly notification?: ClientProxy,
  ) {}

  @Get('withdrawals')
  @Roles(Role.ADMIN, Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Pul yechish so‘rovlari (holat, sotuvchi filtri)' })
  @ApiOkResponse({ type: WithdrawalPageDto })
  list(@Query() query: AdminWithdrawalQueryDto): Promise<WithdrawalPageDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_WITHDRAWAL_RPC.ADMIN_LIST },
      { query },
    );
  }

  @Post('withdrawals/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Tasdiqlash',
    description:
      '5 mln dan katta so‘rov ikki xil xodim tasdig‘idan keyin «Tasdiqlandi» bo‘ladi; bir xodim ikki marta tasdiqlay olmaydi. Maqomi tasdiqlanmagan sotuvchi — 400.',
  })
  @ApiOkResponse({ type: WithdrawalDto })
  @ApiNotFoundResponse({ description: 'So‘rov topilmadi' })
  @ApiConflictResponse({
    description:
      'INVALID_STATE: holat mos emas yoki shu xodim tasdiqlagan; NAME_CHANGED: ism tasdiqlangandan farq qiladi — maqom qayta tekshiruvda',
  })
  async approve(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser('sub') approverId: string,
  ): Promise<WithdrawalDto> {
    // pul shundan keyin o‘tkaziladi — maqom tasdiqlangan ism bilan hali mos ekani shu yerda tekshiriladi (BE-25 5-tur)
    const { affiliateId } = await sendRpc<WithdrawalDto>(
      this.finance,
      { cmd: FINANCE_WITHDRAWAL_RPC.GET },
      { id },
    );
    const fullName = await currentFullName(this.identity, affiliateId);
    return recheckOnNameChange(
      { finance: this.finance, identity: this.identity },
      { affiliateId, fullName, actorId: approverId },
      () =>
        sendRpc<WithdrawalDto>(
          this.finance,
          { cmd: FINANCE_WITHDRAWAL_RPC.APPROVE },
          { id, approverId, currentFullName: fullName },
        ),
    );
  }

  @Post('withdrawals/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Rad etish (sabab bilan); band summa bo‘shaydi' })
  @ApiOkResponse({ type: WithdrawalDto })
  @ApiNotFoundResponse({ description: 'So‘rov topilmadi' })
  @ApiConflictResponse({
    description: 'INVALID_STATE: to‘langan yoki rad etilgan',
  })
  reject(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser('sub') rejectedBy: string,
    @Body() dto: RejectWithdrawalDto,
  ): Promise<WithdrawalDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_WITHDRAWAL_RPC.REJECT },
      { id, rejectedBy, reason: dto.reason },
    );
  }

  @Post('withdrawals/:id/paid')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary: '«To‘landi»: moliya kartaga qo‘lda o‘tkazdi',
    description:
      'Faqat tasdiqlangan so‘rov; ledgerga jurnal: sotuvchidan −summa, 1% soliq alohida qator. Takror bosilsa — o‘sha natija.',
  })
  @ApiOkResponse({ type: WithdrawalDto })
  @ApiNotFoundResponse({ description: 'So‘rov topilmadi' })
  @ApiConflictResponse({
    description:
      'INVALID_STATE: tasdiqlanmagan, tasdiqlar yetmaydi yoki balans yetmaydi',
  })
  async paid(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser('sub') paidBy: string,
  ): Promise<WithdrawalDto> {
    const result = await sendRpc<WithdrawalDto>(
      this.finance,
      { cmd: FINANCE_WITHDRAWAL_RPC.PAID },
      { id, paidBy },
    );
    // BE-24 (TC4): sotuvchiga «Pul o‘tkazildi» — takror bosilsa ham bitta SMS (notification `dedupeKey`)
    if (this.notification)
      this.notification
        .emit('finance.withdrawal.paid', {
          withdrawalId: String(result.id),
          affiliateId: String(result.affiliateId),
          amount: result.amount,
          tax: result.taxAmount,
          net: result.netAmount,
        })
        .subscribe({
          error: (error: Error) =>
            this.logger.warn(
              `«Pul o‘tkazildi» xabari yuborilmadi: ${error.message}`,
            ),
        });
    return result;
  }

  @Post('withdrawals/:id/payout-result')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Kartaga yuborilgan so‘rov natijasini qo‘lda kiritish (BE-32)',
    description:
      'Provayder javobi kelmagan (`PAYING`) so‘rov: moliya provayder kabinetida tekshirib `PAID` (pul tushgan — jurnal yoziladi) yoki `FAILED` (tushmagan — pul «Mavjud» da qoladi) kiritadi. Izoh majburiy, auditga yoziladi.',
  })
  @ApiOkResponse({ type: WithdrawalDto })
  @ApiNotFoundResponse({ description: 'So‘rov topilmadi' })
  @ApiConflictResponse({
    description: 'INVALID_STATE: so‘rov kartaga yuborilmagan (`PAYING` emas)',
  })
  async payoutResult(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser('sub') actorId: string,
    @Body() dto: PayoutResultDto,
    @Ip() ip: string,
  ): Promise<WithdrawalDto> {
    const result = await sendRpc<WithdrawalDto>(
      this.finance,
      { cmd: FINANCE_WITHDRAWAL_RPC.PAYOUT_RESULT },
      { id, result: dto.result, note: dto.note, actorId },
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action: 'withdrawal.payout.resolve',
        entityType: 'WithdrawalRequest',
        entityId: id,
        meta: { result: dto.result, note: dto.note, ip: ip || null },
      },
    ).catch((error: Error) =>
      this.logger.warn(
        `Audit yozilmadi (withdrawal.payout.resolve ${id}): ${error?.message}`,
      ),
    );
    return result;
  }

  @Put('affiliates/:id/self-employed')
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'O‘zini o‘zi band qilganlik belgisi — arizasiz, qo‘lda',
    description:
      'Belgisiz sotuvchining so‘rovi rad etiladi (T01:471). Sotuvchi ariza yuborgan bo‘lsa — `admin/finance/self-employed` da tasdiqlanadi (bu yerda 409 ALREADY_PENDING).',
  })
  @ApiOkResponse({ type: AffiliateSelfEmployedDto })
  async setSelfEmployed(
    @Param('id', ParseLeadIdPipe) affiliateId: string,
    @CurrentUser('sub') updatedBy: string,
    @Body() dto: SetSelfEmployedDto,
    @Ip() ip: string,
  ): Promise<AffiliateSelfEmployedDto> {
    // qo‘lda tasdiq ham ism bilan bog‘lanadi: ism o‘zgarsa qayta tekshiriladi (BE-25 5-tur)
    const fullName = dto.selfEmployed
      ? await currentFullName(this.identity, affiliateId)
      : '';
    if (dto.selfEmployed && !fullName)
      throw new ConflictException({
        message: 'Sotuvchi profilida ism va familiya yo‘q',
        errorCode: ErrorCode.PROFILE_NAME_REQUIRED,
      });
    const result = await recheckOnNameChange(
      { finance: this.finance, identity: this.identity },
      { affiliateId, fullName, actorId: updatedBy },
      () =>
        sendRpc<AffiliateSelfEmployedDto>(
          this.finance,
          { cmd: FINANCE_WITHDRAWAL_RPC.SELF_EMPLOYED_SET },
          { affiliateId, selfEmployed: dto.selfEmployed, updatedBy, fullName },
        ),
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: updatedBy,
        action: 'self-employed.manual',
        entityType: 'User',
        entityId: affiliateId,
        meta: { affiliateId, selfEmployed: dto.selfEmployed, ip: ip ?? null },
      },
    ).catch((error: Error) =>
      this.logger.warn(`Qo‘lda belgi auditga yozilmadi: ${error.message}`),
    );
    return result;
  }
}
