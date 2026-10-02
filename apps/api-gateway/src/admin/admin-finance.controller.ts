import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateCommissionDto,
  FinanceCommissionDto,
  FinanceLedgerPageDto,
  FinanceLedgerQueryDto,
  FinancePayoutDto,
  FinancePayoutPageDto,
  FinancePayoutQueryDto,
  FinanceReconciliationQueryDto,
  FinanceReconciliationReportDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UpdateCommissionDto,
} from '@app/common';

@ApiTags('admin-finance')
@ApiBearerAuth()
@Controller('admin/finance')
export class AdminFinanceController {
  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
  ) {}

  @Get('ledger')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Sotuvchilar ledger yozuvlari' })
  @ApiOkResponse({ type: FinanceLedgerPageDto })
  ledger(@Query() query: FinanceLedgerQueryDto) {
    return sendRpc(this.finance, { cmd: 'finance.ledger.list' }, { query });
  }

  @Get('payouts')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Payoutlar ro‘yxati' })
  @ApiOkResponse({ type: FinancePayoutPageDto })
  payouts(@Query() query: FinancePayoutQueryDto) {
    return sendRpc(this.finance, { cmd: 'finance.payouts.list' }, { query });
  }

  @Get(['reports', 'reports/reconciliation'])
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'COD reconciliation va netting hisoboti' })
  @ApiOkResponse({ type: FinanceReconciliationReportDto })
  reconciliation(@Query() query: FinanceReconciliationQueryDto) {
    return sendRpc(
      this.finance,
      { cmd: 'finance.reconciliation.report' },
      { query },
    );
  }

  @Post('payouts/:id/approve')
  @Roles(Role.SUPERADMIN)
  @ApiResponse({ status: 201, type: FinancePayoutDto })
  @ApiNotFoundResponse({ description: 'Payout topilmadi' })
  @ApiConflictResponse({ description: 'To‘langan payout o‘zgarmaydi' })
  approve(@Param('id') id: string) {
    return sendRpc(this.finance, { cmd: 'finance.payout.approve' }, { id });
  }

  @Post('payouts/:id/hold')
  @Roles(Role.SUPERADMIN)
  @ApiResponse({ status: 201, type: FinancePayoutDto })
  @ApiNotFoundResponse({ description: 'Payout topilmadi' })
  @ApiConflictResponse({ description: 'To‘langan payout o‘zgarmaydi' })
  hold(@Param('id') id: string) {
    return sendRpc(this.finance, { cmd: 'finance.payout.hold' }, { id });
  }

  @Post('payouts/:id/release')
  @Roles(Role.SUPERADMIN)
  @ApiResponse({ status: 201, type: FinancePayoutDto })
  @ApiNotFoundResponse({ description: 'Payout topilmadi' })
  @ApiConflictResponse({
    description: 'APPROVED emas yoki ledger balansi yetarli emas',
  })
  release(@Param('id') id: string) {
    return sendRpc(this.finance, { cmd: 'finance.payout.release' }, { id });
  }

  @Get('commissions')
  @Roles(Role.SUPERADMIN)
  @ApiOkResponse({ type: [FinanceCommissionDto] })
  commissions() {
    return sendRpc(this.finance, { cmd: 'finance.commissions.list' }, {});
  }

  @Post('commissions')
  @Roles(Role.SUPERADMIN)
  @ApiResponse({ status: 201, type: FinanceCommissionDto })
  upsertCommission(@Body() dto: CreateCommissionDto) {
    return sendRpc(this.finance, { cmd: 'finance.commission.upsert' }, { dto });
  }

  @Patch('commissions/:id')
  @Roles(Role.SUPERADMIN)
  @ApiOkResponse({ type: FinanceCommissionDto })
  @ApiNotFoundResponse({ description: 'Komissiya topilmadi' })
  updateCommission(@Param('id') id: string, @Body() dto: UpdateCommissionDto) {
    return sendRpc(
      this.finance,
      { cmd: 'finance.commission.update' },
      { id, dto },
    );
  }
}
