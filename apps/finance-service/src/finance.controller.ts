import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateCommissionDto,
  FinanceCodSettledEvent,
  FinanceDateRangeQueryDto,
  FinanceLedgerQueryDto,
  FinancePayoutQueryDto,
  FinancePayoutRequestedEvent,
  FinanceRefundRequestedEvent,
  FinanceReconciliationQueryDto,
  PayoutScheduleFrequency,
  RpcHttpExceptionFilter,
  UpdateCommissionDto,
} from '@app/common';
import { FinanceService } from './finance.service';
import { SellerFinanceService } from './seller-finance.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly sellerFinance: SellerFinanceService,
  ) {}

  @EventPattern('finance.payout.requested')
  payoutRequested(@Payload() event: FinancePayoutRequestedEvent) {
    return this.finance.processPayoutRequested(event);
  }

  @EventPattern('finance.refund.requested')
  refundRequested(@Payload() event: FinanceRefundRequestedEvent) {
    return this.finance.refund(event);
  }

  @MessagePattern({ cmd: 'finance.refund' })
  refund(@Payload() event: FinanceRefundRequestedEvent) {
    return this.finance.refund(event);
  }

  @EventPattern('finance.cod.settled')
  codSettled(@Payload() event: FinanceCodSettledEvent) {
    return this.finance.processCodSettled(event);
  }

  @MessagePattern({ cmd: 'finance.reconciliation.report' })
  reconciliationReport(
    @Payload() data: { query: FinanceReconciliationQueryDto },
  ) {
    return this.finance.reconciliationReport(data.query);
  }

  @MessagePattern({ cmd: 'finance.ledger.list' })
  listLedger(@Payload() data: { query: FinanceLedgerQueryDto }) {
    return this.finance.listLedger(data.query);
  }

  @MessagePattern({ cmd: 'finance.seller.summary' })
  sellerSummary(
    @Payload() data: { shopId: string; query?: FinanceDateRangeQueryDto },
  ) {
    return this.sellerFinance.summary(data.shopId, data.query);
  }

  @MessagePattern({ cmd: 'finance.payout-schedule.get' })
  getPayoutSchedule(@Payload() data: { shopId: string }) {
    return this.sellerFinance.getSchedule(data.shopId);
  }

  @MessagePattern({ cmd: 'finance.payout-schedule.update' })
  updatePayoutSchedule(
    @Payload() data: { shopId: string; frequency: PayoutScheduleFrequency },
  ) {
    return this.sellerFinance.updateSchedule(data.shopId, data.frequency);
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
