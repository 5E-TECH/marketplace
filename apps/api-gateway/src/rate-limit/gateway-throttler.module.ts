import { DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { RateLimitModule } from './rate-limit.module';
import { SharedThrottlerStorage } from './shared-throttler.storage';

/**
 * Gateway rate limit — umumiy chegara (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`). Auth kabi nozik endpointlarda
 * controller darajasida `@Throttle` bilan qattiqroq limit qo‘yiladi. BE-36: saqlagich — `SharedThrottlerStorage`
 * (`REDIS_URL` bilan bir nechta gateway nusxasida umumiy). app.module va TC1 testi shu modulni ishlatadi — ulanish
 * testda tekshiriladi.
 */
export function gatewayThrottlerModule(): DynamicModule {
  return ThrottlerModule.forRootAsync({
    imports: [RateLimitModule],
    inject: [ConfigService, SharedThrottlerStorage],
    useFactory: (config: ConfigService, storage: SharedThrottlerStorage) => ({
      throttlers: [
        {
          name: 'default',
          ttl: config.get<number>('RATE_LIMIT_WINDOW_MS', 60_000),
          limit: config.get<number>('RATE_LIMIT_MAX', 300),
        },
      ],
      storage,
    }),
  });
}
