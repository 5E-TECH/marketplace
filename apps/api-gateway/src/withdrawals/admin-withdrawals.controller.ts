import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
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
  FINANCE_WITHDRAWAL_RPC,
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

/**
 * Moliya: pul yechish so‘rovlari (BE-23; MOL-5, FE-20). Tasdiq, rad va «To‘landi» — moliya xodimi (T01:170);
 * FINANCE va SUPERADMIN (BE-05). Ro‘yxatni ADMIN ham ko‘radi (eski payout kabi).
 */
@ApiTags('admin-finance')
@ApiBearerAuth()
@Controller('admin/finance')
export class AdminWithdrawalsController {
  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
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
      '5 mln dan katta so‘rov ikki xil xodim tasdig‘idan keyin «Tasdiqlandi» bo‘ladi; bir xodim ikki marta tasdiqlay olmaydi.',
  })
  @ApiOkResponse({ type: WithdrawalDto })
  @ApiNotFoundResponse({ description: 'So‘rov topilmadi' })
  @ApiConflictResponse({
    description: 'INVALID_STATE: holat mos emas yoki shu xodim tasdiqlagan',
  })
  approve(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser('sub') approverId: string,
  ): Promise<WithdrawalDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_WITHDRAWAL_RPC.APPROVE },
      { id, approverId },
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
  paid(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser('sub') paidBy: string,
  ): Promise<WithdrawalDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_WITHDRAWAL_RPC.PAID },
      { id, paidBy },
    );
  }

  @Put('affiliates/:id/self-employed')
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'O‘zini o‘zi band qilganlik belgisi (moliya tekshirgach qo‘lda)',
    description: 'Belgisiz sotuvchining so‘rovi rad etiladi (T01:471).',
  })
  @ApiOkResponse({ type: AffiliateSelfEmployedDto })
  setSelfEmployed(
    @Param('id', ParseLeadIdPipe) affiliateId: string,
    @CurrentUser('sub') updatedBy: string,
    @Body() dto: SetSelfEmployedDto,
  ): Promise<AffiliateSelfEmployedDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_WITHDRAWAL_RPC.SELF_EMPLOYED_SET },
      { affiliateId, selfEmployed: dto.selfEmployed, updatedBy },
    );
  }
}
