import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  PLATFORM_METRICS_RPC,
  PlatformMetricsGroupBy,
  RpcHttpExceptionFilter,
} from '@app/common';
import { PlatformStatsService } from './platform-stats.service';

/** BE-46: admin ko‘rsatkichlari (TZ 9-bo‘lim) — lid-servis qismi. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class PlatformStatsController {
  constructor(private readonly stats: PlatformStatsService) {}

  @MessagePattern({ cmd: PLATFORM_METRICS_RPC.LEADS })
  platform(
    @Payload()
    data: {
      from: string;
      to: string;
      groupBy?: PlatformMetricsGroupBy;
    },
  ) {
    return this.stats.platform(data);
  }
}
