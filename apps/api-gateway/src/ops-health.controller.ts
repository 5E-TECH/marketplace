import {
  Controller,
  Get,
  Headers,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import {
  IgnoreAuthCookie,
  LeadQueueStats,
  OPS_RPC,
  OpsHealthDto,
  Public,
  RmqClient,
  sendRpc,
} from '@app/common';
import { SharedThrottlerStorage } from './rate-limit/shared-throttler.storage';

/**
 * BE-26 (T8 «Kuzatuv»): `scripts/health-monitor.mjs` uchun ko‘rsatkichlar — Elchi API xatolari (5 daqiqa) va operator
 * navbati. Ochiq API emas: `MONITOR_TOKEN` sarlavhada (`x-monitor-token`) mos kelmasa yoki token sozlanmagan bo‘lsa —
 * 404 (yo‘l borligi ham bilinmasin). Shartnomaga (OpenAPI) kirmaydi. BE-36: so‘rov chegarasi qayerda sanalmoqda
 * (`rateLimit`) — Redis berilgan, lekin uzilgan bo‘lsa monitor ogohlantiradi.
 */
@ApiExcludeController()
@Controller('health')
export class OpsHealthController {
  private readonly logger = new Logger(OpsHealthController.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    private readonly throttlerStorage: SharedThrottlerStorage,
  ) {}

  @Public()
  @IgnoreAuthCookie()
  @Get('ops')
  async ops(
    @Headers('x-monitor-token') token: string | undefined,
  ): Promise<OpsHealthDto> {
    if (!this.authorized(token)) throw new NotFoundException();
    const [elchi, queue] = await Promise.all([
      sendRpc<{ count: number }>(
        this.integration,
        { cmd: OPS_RPC.ELCHI_ERRORS },
        { minutes: 5 },
      ).catch((error: Error) => this.failed('elchi', error)),
      sendRpc<LeadQueueStats>(this.lead, { cmd: OPS_RPC.LEAD_QUEUE }, {}).catch(
        (error: Error) => this.failed('lead', error),
      ),
    ]);
    return {
      elchiApiErrors5m: elchi ? elchi.count : null,
      leadQueue: queue ?? null,
      rateLimit: this.throttlerStorage.health(),
    };
  }

  private authorized(token: string | undefined): boolean {
    const expected = this.config.get<string>('MONITOR_TOKEN') ?? '';
    if (expected.length < 16 || !token) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private failed(source: string, error: Error): null {
    this.logger.warn(`ops ${source}: ${error.message}`);
    return null;
  }
}
