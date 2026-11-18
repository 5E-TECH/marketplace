import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
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

  @MessagePattern({ cmd: 'finance.balance-check.latest' })
  balanceLatest() {
    return this.balance.latest();
  }

  @MessagePattern({ cmd: 'finance.balance-check.run' })
  balanceRun() {
    return this.balance.run();
  }
}
