import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { RateLimitHealth, SharedRateLimiter } from '@app/common';

/**
 * BE-36 (TC1): gateway throttler saqlagichi. `REDIS_URL` berilsa — hisob Redis’da, bir nechta gateway nusxasida IP
 * limiti umumiy (`@Throttle` bilan qo‘yilgan auth limitlari ham). Berilmasa — avvalgidek `@nestjs/throttler` xotira
 * saqlagichi (xatti-harakat o‘zgarmaydi). Redis uzilsa — har nusxa o‘z xotirasida sanaydi, monitor ogohlantiradi
 * (`GET /health/ops` → `rateLimit`).
 */
@Injectable()
export class SharedThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly shared: SharedRateLimiter | null;
  private readonly local = new ThrottlerStorageService();

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    this.shared = url
      ? new SharedRateLimiter({ url, prefix: 'mp:rl:gw:', name: 'api-gateway' })
      : null;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): ReturnType<ThrottlerStorage['increment']> {
    if (!this.shared)
      return this.local.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    // `key` — @nestjs/throttler xeshi (controller, handler, IP, limit nomi): hamma nusxada bir xil.
    const hit = await this.shared.hit(
      `${throttlerName}:${key}`,
      ttl,
      limit,
      blockDuration,
    );
    // Throttler sarlavhalari (X-RateLimit-Reset, Retry-After) soniyada.
    return {
      totalHits: hit.totalHits,
      timeToExpire: Math.ceil(hit.timeToExpireMs / 1000),
      isBlocked: hit.isBlocked,
      timeToBlockExpire: Math.ceil(hit.timeToBlockExpireMs / 1000),
    };
  }

  health(): RateLimitHealth {
    return {
      redisConfigured: this.shared?.redisConfigured ?? false,
      store: this.shared?.store ?? 'memory',
    };
  }

  async onApplicationShutdown(): Promise<void> {
    this.local.onApplicationShutdown();
    await this.shared?.close();
  }
}
