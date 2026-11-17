import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  AffiliateLeadsQueryDto,
  AffiliateStatsQueryDto,
  LeadStatsPeriodQueryDto,
  ORDER_EVENTS,
  OrderStatusChangedEvent,
  RpcHttpExceptionFilter,
} from '@app/common';
import { LeadOrderService } from './lead-order.service';
import { LeadStatsService } from './lead-stats.service';

/** Statistika (BE-28; SOT-4, OPR-7) va buyurtma holati hodisasi. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadStatsController {
  constructor(
    private readonly stats: LeadStatsService,
    private readonly orders: LeadOrderService,
  ) {}

  @MessagePattern({ cmd: 'lead.stats.affiliate' })
  affiliate(
    @Payload() input: { affiliateId: string; query: AffiliateStatsQueryDto },
  ) {
    return this.stats.affiliateStats(input);
  }

  @MessagePattern({ cmd: 'lead.stats.affiliate-leads' })
  affiliateLeads(
    @Payload() input: { affiliateId: string; query: AffiliateLeadsQueryDto },
  ) {
    return this.stats.affiliateLeads(input);
  }

  @MessagePattern({ cmd: 'lead.stats.operator' })
  operator(
    @Payload() input: { operatorId: string; query: LeadStatsPeriodQueryDto },
  ) {
    return this.stats.operatorStats(input);
  }

  /** checkout → lead-service: buyurtma holati (BE-18 yuboradi; relay LEAD navbatiga ham). */
  @EventPattern(ORDER_EVENTS.STATUS_CHANGED)
  orderStatusChanged(@Payload() event: OrderStatusChangedEvent) {
    return this.orders.onOrderStatusChanged(event);
  }
}
