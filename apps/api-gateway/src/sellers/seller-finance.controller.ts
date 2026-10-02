import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Put,
  Query,
} from '@nestjs/common';
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
  FinanceDateRangeQueryDto,
  FinanceLedgerPageDto,
  FinancePayoutPageDto,
  JwtUser,
  PayoutScheduleDto,
  RmqClient,
  Role,
  Roles,
  SellerFinanceLedgerQueryDto,
  SellerFinancePayoutQueryDto,
  SellerFinanceSummaryDto,
  sendRpc,
  UpdatePayoutScheduleDto,
} from '@app/common';

/**
 * Sotuvchi kabineti moliyasi — `/admin/finance/*` dagi ma'lumotning o'z
 * do'koni kesimi. Do'kon faqat token egasidan (catalog, ownerUserId)
 * aniqlanadi; query'da `shopId` qabul qilinmaydi. Faqat do'kon egasi:
 * operator buyurtmalar bilan ishlaydi, pul ma'lumotiga kirmaydi.
 */
@ApiTags('seller')
@ApiBearerAuth()
@Controller('seller/finance')
export class SellerFinanceController {
  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  private async shopId(user: JwtUser): Promise<string> {
    const shop = await sendRpc<{ id: string } | null>(
      this.catalog,
      { cmd: 'seller.shop.get-me' },
      { ownerUserId: user.sub },
    );
    // shopId'siz finance so'rovi butun platforma ma'lumotini qaytaradi.
    if (!shop?.id)
      throw new NotFoundException('Sotuvchining do‘koni topilmadi');
    return String(shop.id);
  }

  @Get('ledger')
  @Roles(Role.SELLER)
  @ApiOperation({
    summary: 'Do‘kon ledger yozuvlari (sotuv, komissiya, payout, refund)',
  })
  @ApiOkResponse({ type: FinanceLedgerPageDto })
  async ledger(
    @CurrentUser() user: JwtUser,
    @Query() query: SellerFinanceLedgerQueryDto,
  ) {
    const shopId = await this.shopId(user);
    return sendRpc(
      this.finance,
      { cmd: 'finance.ledger.list' },
      { query: { ...query, shopId } },
    );
  }

  @Get('payouts')
  @Roles(Role.SELLER)
  @ApiOperation({ summary: 'Do‘kon payout’lari' })
  @ApiOkResponse({ type: FinancePayoutPageDto })
  async payouts(
    @CurrentUser() user: JwtUser,
    @Query() query: SellerFinancePayoutQueryDto,
  ) {
    const shopId = await this.shopId(user);
    return sendRpc(
      this.finance,
      { cmd: 'finance.payouts.list' },
      { query: { ...query, shopId } },
    );
  }

  @Get('summary')
  @Roles(Role.SELLER)
  @ApiOperation({
    summary: 'Moliya jamlanmasi: balans, payout’lar, COD reconciliation',
    description:
      '`dateFrom`/`dateTo` faqat davr ko‘rsatkichlariga ta’sir qiladi ' +
      '(`paidPayoutAmount`, `cod`); balans va kutilayotgan payout — hozirgi holat.',
  })
  @ApiOkResponse({ type: SellerFinanceSummaryDto })
  async summary(
    @CurrentUser() user: JwtUser,
    @Query() query: FinanceDateRangeQueryDto,
  ) {
    const shopId = await this.shopId(user);
    return sendRpc(
      this.finance,
      { cmd: 'finance.seller.summary' },
      { shopId, query },
    );
  }

  @Get('payout-schedule')
  @Roles(Role.SELLER)
  @ApiOperation({ summary: 'Payout chastotasi va keyingi to‘lov kuni' })
  @ApiOkResponse({ type: PayoutScheduleDto })
  async getPayoutSchedule(@CurrentUser() user: JwtUser) {
    const shopId = await this.shopId(user);
    return sendRpc(
      this.finance,
      { cmd: 'finance.payout-schedule.get' },
      { shopId },
    );
  }

  @Put('payout-schedule')
  @Roles(Role.SELLER)
  @ApiOperation({
    summary: 'Payout chastotasini tanlash (DAILY | WEEKLY | MONTHLY)',
  })
  @ApiOkResponse({ type: PayoutScheduleDto })
  @ApiBadRequestResponse({ description: 'Noma’lum chastota' })
  async updatePayoutSchedule(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdatePayoutScheduleDto,
  ) {
    const shopId = await this.shopId(user);
    return sendRpc(
      this.finance,
      { cmd: 'finance.payout-schedule.update' },
      { shopId, frequency: dto.frequency },
    );
  }
}
