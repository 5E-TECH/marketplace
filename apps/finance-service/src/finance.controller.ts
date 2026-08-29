import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateCommissionDto,
  FinancePageQueryDto,
  FinancePayoutQueryDto,
  FinancePayoutRequestedEvent,
  FinanceRefundRequestedEvent,
  RpcHttpExceptionFilter,
  UpdateCommissionDto,
} from '@app/common';
import { FinanceService } from './finance.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @EventPattern('finance.payout.requested')
  payoutRequested(@Payload() event: FinancePayoutRequestedEvent) {
    return this.finance.processPayoutRequested(event);
  }

  @EventPattern('finance.refund.requested')
  refundRequested(@Payload() event: FinanceRefundRequestedEvent) {
    return this.finance.refund(event);
  }

  @MessagePattern({ cmd: 'finance.ledger.list' })
  listLedger(@Payload() data: { query: FinancePageQueryDto }) {
    return this.finance.listLedger(data.query);
  }

  @MessagePattern({ cmd: 'finance.payouts.list' })
  listPayouts(@Payload() data: { query: FinancePayoutQueryDto }) {
    return this.finance.listPayouts(data.query);
  }

  @MessagePattern({ cmd: 'finance.payout.approve' })
  approvePayout(@Payload() data: { id: string }) {
    return this.finance.approvePayout(data.id);
  }

  @MessagePattern({ cmd: 'finance.payout.hold' })
  holdPayout(@Payload() data: { id: string }) {
    return this.finance.holdPayout(data.id);
  }

  @MessagePattern({ cmd: 'finance.payout.release' })
  releasePayout(@Payload() data: { id: string }) {
    return this.finance.releasePayout(data.id);
  }

  @MessagePattern({ cmd: 'finance.commissions.list' })
  listCommissions() {
    return this.finance.listCommissions();
  }

  @MessagePattern({ cmd: 'finance.commission.upsert' })
  upsertCommission(@Payload() data: { dto: CreateCommissionDto }) {
    return this.finance.upsertCommission(data.dto);
  }

  @MessagePattern({ cmd: 'finance.commission.update' })
  updateCommission(@Payload() data: { id: string; dto: UpdateCommissionDto }) {
    return this.finance.updateCommission(data.id, data.dto);
  }
}
