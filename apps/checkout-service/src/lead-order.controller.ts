import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  LEAD_EVENTS,
  LEAD_ORDER_RPC,
  LeadConfirmedEvent,
  LeadOrderActor,
  LeadOrderTransitionInput,
  RpcHttpExceptionFilter,
} from '@app/common';
import { LeadOrderService } from './lead-order.service';
import { LeadOrderStatusService } from './lead-order-status.service';

/** Liddan buyurtma (BE-18): `lead.confirmed` qabul qilish, holat o‘tishlari va bekor qilish. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadOrderController {
  constructor(
    private readonly orders: LeadOrderService,
    private readonly status: LeadOrderStatusService,
  ) {}

  @EventPattern(LEAD_EVENTS.CONFIRMED)
  async onLeadConfirmed(@Payload() event: LeadConfirmedEvent): Promise<void> {
    await this.orders.onLeadConfirmed(event);
  }

  /** BE-19 (ombor), BE-21 (Elchi webhook), moliya — faqat ruxsat etilgan o‘tish (BUY-2). */
  @MessagePattern({ cmd: LEAD_ORDER_RPC.TRANSITION })
  transition(@Payload() data: LeadOrderTransitionInput) {
    return this.status.transition(data);
  }

  /** BUY-3: operator, nazoratchi yoki admin — Elchi’ga topshirilgunga qadar, sabab bilan. */
  @MessagePattern({ cmd: LEAD_ORDER_RPC.CANCEL })
  cancel(
    @Payload() data: { orderId: string; reason: string; actor: LeadOrderActor },
  ) {
    return this.status.cancel(data);
  }
}
