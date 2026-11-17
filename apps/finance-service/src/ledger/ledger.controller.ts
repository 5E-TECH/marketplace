import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
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

  @MessagePattern({ cmd: 'finance.accounts.list' })
  accounts(@Payload() data: { type?: string } = {}) {
    return this.queries.accounts(data?.type);
  }

  @MessagePattern({ cmd: 'finance.order.split' })
  orderSplit(@Payload() data: { orderId: string }) {
    return this.queries.orderSplit(String(data?.orderId ?? ''));
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
