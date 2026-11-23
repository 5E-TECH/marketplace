import { Module } from '@nestjs/common';
import { SharedThrottlerStorage } from './shared-throttler.storage';

/** BE-36: throttler saqlagichi — ThrottlerModule va `GET /health/ops` uchun bitta nusxa. */
@Module({
  providers: [SharedThrottlerStorage],
  exports: [SharedThrottlerStorage],
})
export class RateLimitModule {}
