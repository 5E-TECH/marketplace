import { Controller, Inject, Optional, UseFilters } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import {
  LeadQueueStats,
  OPS_RPC,
  RateLimitHealth,
  RpcHttpExceptionFilter,
  SharedRateLimiter,
} from '@app/common';
import { API_KEY_RATE_LIMITER } from './api-key.service';
import { clampToCallWindow } from './lead-schedule';

/**
 * BE-26 (T8 «Kuzatuv»: lid navbati o‘sishi): operator navbatidagi yangi lidlar va eng eskisi qancha kutyapti.
 * Shart operator navbati bilan bir xil (`LeadQueueService.pick` «fresh»: tekshiruvdagi va birlashtirilgan — yo‘q).
 * Kutish qo‘ng‘iroq oynasidan (3-qoida, 09:00–21:00 Toshkent) hisoblanadi: kechasi kelgan lid ertalab 09:00 dan;
 * oyna tashqarisida — `oldestMinutes: null` (ogohlantirish yo‘q).
 */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadOpsController {
  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    @Inject(API_KEY_RATE_LIMITER)
    private readonly apiKeyLimiter?: SharedRateLimiter,
  ) {}

  /** BE-36: lid API kaliti chegarasi — Redis berilgan, lekin uzilgan bo‘lsa monitor ogohlantiradi. */
  @MessagePattern({ cmd: OPS_RPC.LEAD_RATE_LIMIT })
  rateLimit(): RateLimitHealth {
    return {
      redisConfigured: this.apiKeyLimiter?.redisConfigured ?? false,
      store: this.apiKeyLimiter?.store ?? 'memory',
    };
  }

  @MessagePattern({ cmd: OPS_RPC.LEAD_QUEUE })
  async queue(): Promise<LeadQueueStats> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS waiting, min(COALESCE(next_attempt_at, created_at)) AS oldest
         FROM lead.lead
        WHERE is_deleted = FALSE AND review_reason IS NULL AND merged_into_id IS NULL
          AND status = 'NEW' AND (next_attempt_at IS NULL OR next_attempt_at <= now())`,
    )) as Array<{ waiting: number; oldest: Date | null }>;
    return leadQueueStats(row?.waiting ?? 0, row?.oldest ?? null, new Date());
  }
}

/** Sof hisob (test uchun alohida). */
export function leadQueueStats(
  waiting: number,
  oldest: Date | null,
  now: Date,
): LeadQueueStats {
  // oyna tashqarisi — operatorlar ishlamaydi, kutish hisoblanmaydi
  if (!oldest || clampToCallWindow(now).getTime() !== now.getTime())
    return { waiting, oldestMinutes: null };
  const start = clampToCallWindow(new Date(oldest));
  return {
    waiting,
    oldestMinutes:
      start.getTime() > now.getTime()
        ? 0
        : Math.floor((now.getTime() - start.getTime()) / 60_000),
  };
}
