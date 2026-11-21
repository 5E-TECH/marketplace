import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  FINANCE_RECONCILIATION_RPC,
  PLATFORM_METRICS_RPC,
  RemittanceItemsQueryDto,
  RpcHttpExceptionFilter,
} from '@app/common';
import { PlatformMetricsService } from './platform-metrics.service';
import { RemittanceService } from './remittance.service';

/** BE-46: TZ 9-bo‘lim moliya ko‘rsatkichlari va Elchi sverkasi (FE-19, FE-22). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class ReconciliationController {
  constructor(
    private readonly metrics: PlatformMetricsService,
    private readonly remittances: RemittanceService,
  ) {}

  @MessagePattern({ cmd: PLATFORM_METRICS_RPC.FINANCE })
  platformMetrics(@Payload() input: { from?: string; to?: string }) {
    return this.metrics.platform(input);
  }

  @MessagePattern({ cmd: FINANCE_RECONCILIATION_RPC.DAYS })
  days(@Payload() input: { from?: string; to?: string }) {
    return this.remittances.days(input);
  }

  @MessagePattern({ cmd: FINANCE_RECONCILIATION_RPC.ITEMS })
  items(@Payload() input: { query?: RemittanceItemsQueryDto }) {
    return this.remittances.items(input);
  }

  @MessagePattern({ cmd: FINANCE_RECONCILIATION_RPC.RESOLVE })
  resolve(
    @Payload() input: { id?: string; comment?: string; userId?: string },
  ) {
    return this.remittances.resolve(input);
  }
}
