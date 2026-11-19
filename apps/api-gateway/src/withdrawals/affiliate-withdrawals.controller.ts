import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AffiliateBalanceDto,
  CreateWithdrawalDto,
  CurrentUser,
  FINANCE_WITHDRAWAL_RPC,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  WithdrawalDto,
  WithdrawalPageDto,
  WithdrawalQueryDto,
} from '@app/common';

/**
 * Sotuvchi kabineti: balans va pul yechish (BE-23; SOT-7, MOL-5). Sotuvchi ID si tokendan (`sub`).
 * Faqat sotuvchi (BE-05; boshqa `/affiliate` yo‘llari kabi).
 */
@ApiTags('affiliate')
@Roles(Role.AFFILIATE)
@ApiBearerAuth()
@Controller('affiliate')
export class AffiliateWithdrawalsController {
  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
  ) {}

  @Get('balance')
  @ApiOperation({
    summary: 'Balans: ushlab turilgan, mavjud, band va yechish mumkin',
    description:
      'blockReason bo‘sh bo‘lmasa so‘rov tugmasi yopiq: maqom yo‘q, bugun so‘rov bor yoki summa minimaldan kam (BE-23).',
  })
  @ApiOkResponse({ type: AffiliateBalanceDto })
  balance(
    @CurrentUser('sub') affiliateId: string,
  ): Promise<AffiliateBalanceDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_WITHDRAWAL_RPC.BALANCE },
      { affiliateId },
    );
  }

  @Post('withdrawals')
  @ApiOperation({
    summary: 'Pul yechish so‘rovi',
    description:
      'Kuniga 1 ta, kamida 50 000 so‘m, 1% soliq ushlanadi; 5 mln dan katta — ikki tasdiq. O‘zini o‘zi band qilganlik belgisi bo‘lmasa rad (BE-23).',
  })
  @ApiCreatedResponse({ type: WithdrawalDto })
  @ApiBadRequestResponse({
    description:
      'BUSINESS_RULE_VIOLATION: minimaldan kam, bugun so‘rov bor, maqom yo‘q yoki balans yetmaydi',
  })
  create(
    @CurrentUser('sub') affiliateId: string,
    @Body() dto: CreateWithdrawalDto,
  ): Promise<WithdrawalDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_WITHDRAWAL_RPC.CREATE },
      { affiliateId, amount: dto.amount },
    );
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'Mening so‘rovlarim (yangilari birinchi)' })
  @ApiOkResponse({ type: WithdrawalPageDto })
  list(
    @CurrentUser('sub') affiliateId: string,
    @Query() query: WithdrawalQueryDto,
  ): Promise<WithdrawalPageDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_WITHDRAWAL_RPC.LIST_MINE },
      { affiliateId, query },
    );
  }
}
