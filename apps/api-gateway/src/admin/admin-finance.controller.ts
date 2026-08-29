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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateCommissionDto,
  FinancePageQueryDto,
  FinancePayoutQueryDto,
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
  ledger(@Query() query: FinancePageQueryDto) {
    return sendRpc(this.finance, { cmd: 'finance.ledger.list' }, { query });
  }

  @Get('payouts')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Payoutlar ro‘yxati' })
  payouts(@Query() query: FinancePayoutQueryDto) {
    return sendRpc(this.finance, { cmd: 'finance.payouts.list' }, { query });
  }

  @Post('payouts/:id/approve')
  @Roles(Role.SUPERADMIN)
  approve(@Param('id') id: string) {
    return sendRpc(this.finance, { cmd: 'finance.payout.approve' }, { id });
  }

  @Post('payouts/:id/hold')
  @Roles(Role.SUPERADMIN)
  hold(@Param('id') id: string) {
    return sendRpc(this.finance, { cmd: 'finance.payout.hold' }, { id });
  }

  @Post('payouts/:id/release')
  @Roles(Role.SUPERADMIN)
  release(@Param('id') id: string) {
    return sendRpc(this.finance, { cmd: 'finance.payout.release' }, { id });
  }

  @Get('commissions')
  @Roles(Role.SUPERADMIN)
  commissions() {
    return sendRpc(this.finance, { cmd: 'finance.commissions.list' }, {});
  }

  @Post('commissions')
  @Roles(Role.SUPERADMIN)
  upsertCommission(@Body() dto: CreateCommissionDto) {
    return sendRpc(this.finance, { cmd: 'finance.commission.upsert' }, { dto });
  }

  @Patch('commissions/:id')
  @Roles(Role.SUPERADMIN)
  updateCommission(@Param('id') id: string, @Body() dto: UpdateCommissionDto) {
    return sendRpc(
      this.finance,
      { cmd: 'finance.commission.update' },
      { id, dto },
    );
  }
}
