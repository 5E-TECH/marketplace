import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ELCHI_CHECK_RPC,
  ElchiCheckItemsQueryDto,
  FINANCE_RECONCILIATION_RPC,
  PLATFORM_METRICS_RPC,
  PlatformAffiliateIncomeQuery,
  RemittanceItemsQueryDto,
  RpcHttpExceptionFilter,
} from '@app/common';
import { ElchiCheckService } from './elchi-check.service';
import { PlatformMetricsService } from './platform-metrics.service';
import { RemittanceService } from './remittance.service';

/** BE-46: TZ 9-bo‘lim moliya ko‘rsatkichlari va Elchi sverkasi (FE-19, FE-22). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class ReconciliationController {
  constructor(
    private readonly metrics: PlatformMetricsService,
    private readonly remittances: RemittanceService,
    private readonly elchiCheck: ElchiCheckService,
  ) {}

  @MessagePattern({ cmd: PLATFORM_METRICS_RPC.FINANCE })
  platformMetrics(@Payload() input: { from?: string; to?: string }) {
    return this.metrics.platform(input);
  }

  @MessagePattern({ cmd: PLATFORM_METRICS_RPC.AFFILIATE_INCOME })
  affiliateIncome(@Payload() input: PlatformAffiliateIncomeQuery) {
    return this.metrics.affiliateIncome(input);
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

  /** BE-46 TC3: Elchi bilan kunlik avtomatik tekshiruv (ega 2026-11-24 «Avtomatik so‘rov»). */
  @MessagePattern({ cmd: ELCHI_CHECK_RPC.RUN })
  elchiCheckRun(@Payload() input: { userId?: string }) {
    return this.elchiCheck.start(input ?? {});
  }

  @MessagePattern({ cmd: ELCHI_CHECK_RPC.GET })
  elchiCheckGet(@Payload() input: { date?: string }) {
    return this.elchiCheck.get(input ?? {});
  }

  @MessagePattern({ cmd: ELCHI_CHECK_RPC.ITEMS })
  elchiCheckItems(@Payload() input: { query?: ElchiCheckItemsQueryDto }) {
    return this.elchiCheck.items(input ?? {});
  }

  @MessagePattern({ cmd: ELCHI_CHECK_RPC.RESOLVE })
  elchiCheckResolve(
    @Payload() input: { id?: string; comment?: string; userId?: string },
  ) {
    return this.elchiCheck.resolve(input ?? {});
  }
}
