import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  COD_DAILY_CHECK_RPC,
  FINANCE_AFFILIATE_RPC,
  FinanceAffiliateIncomeQuery,
  FraudFeeEvent,
  LEAD_EVENTS,
  ORDER_EVENTS,
  OrderReturnedEvent,
  OrderStatusChangedEvent,
  RpcHttpExceptionFilter,
} from '@app/common';
import { BalanceCheckService } from './balance-check.service';
import { CodDailyCheckService } from './cod-daily-check.service';
import { LedgerQueryService } from './ledger-query.service';
import { LedgerService } from './ledger.service';

/** BE-22: yangi hisoblar modeli hodisalari va o'qish RPC lari [taklif nomlar]. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LedgerController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly queries: LedgerQueryService,
    private readonly balance: BalanceCheckService,
    private readonly codDaily: CodDailyCheckService,
  ) {}

  @EventPattern(ORDER_EVENTS.STATUS_CHANGED)
  orderStatusChanged(@Payload() event: OrderStatusChangedEvent) {
    return this.ledger.onOrderStatusChanged(event);
  }

  @EventPattern(ORDER_EVENTS.RETURNED)
  orderReturned(@Payload() event: OrderReturnedEvent) {
    return this.ledger.onOrderReturned(event);
  }

  /** BE-35: firibgarlik markazi — sotuvchi haqini ushlash, qo‘yib yuborish, bekor qilish. */
  @EventPattern(LEAD_EVENTS.FRAUD_FEE_HOLD)
  feeHold(@Payload() event: FraudFeeEvent) {
    return this.ledger.onFeeHold(event, 'HELD');
  }

  @EventPattern(LEAD_EVENTS.FRAUD_FEE_RELEASE)
  feeRelease(@Payload() event: FraudFeeEvent) {
    return this.ledger.onFeeHold(event, 'RELEASED');
  }

  @EventPattern(LEAD_EVENTS.FRAUD_FEE_CANCEL)
  feeCancel(@Payload() event: FraudFeeEvent) {
    return this.ledger.onFeeHold(event, 'CANCELLED');
  }

  @MessagePattern({ cmd: 'finance.accounts.list' })
  accounts(@Payload() data: { type?: string } = {}) {
    return this.queries.accounts(data?.type);
  }

  @MessagePattern({ cmd: 'finance.order.split' })
  orderSplit(@Payload() data: { orderId: string }) {
    return this.queries.orderSplit(String(data?.orderId ?? ''));
  }

  /** Sotuvchi daromadi statistikasi uchun (BE-28, lead-service chaqiradi). */
  @MessagePattern({ cmd: FINANCE_AFFILIATE_RPC.INCOME })
  affiliateIncome(@Payload() data: FinanceAffiliateIncomeQuery) {
    return this.queries.affiliateIncome(data);
  }

  /** BE-21 (TZ ELC-4): kunlik COD sverkasi. */
  @MessagePattern({ cmd: COD_DAILY_CHECK_RPC.GET })
  codDailyGet(@Payload() data: { date?: string }) {
    return this.codDaily.get(data);
  }

  @MessagePattern({ cmd: COD_DAILY_CHECK_RPC.RUN })
  codDailyRun(@Payload() data: { date?: string }) {
    return this.codDaily.run(data);
  }

  @MessagePattern({ cmd: 'finance.balance-check.latest' })
  balanceLatest() {
    return this.balance.latest();
  }

  @MessagePattern({ cmd: 'finance.balance-check.run' })
  balanceRun() {
    return this.balance.run();
  }
}
