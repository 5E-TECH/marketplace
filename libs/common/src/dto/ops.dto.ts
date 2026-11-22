import { ApiProperty } from '@nestjs/swagger';

/** BE-26 (T8 «Kuzatuv»): monitor ko‘rsatkichlari — servislardan ichki RPC. */
export const OPS_RPC = {
  /** elchi-integration: oxirgi N daqiqadagi Elchi API xatolari soni. */
  ELCHI_ERRORS: 'integration.ops.errors',
  /** lead-service: operator navbatida kutayotgan yangi lidlar va eng eskisining kutish vaqti. */
  LEAD_QUEUE: 'lead.ops.queue',
} as const;

export interface LeadQueueStats {
  /** Navbatda (qo‘ng‘iroq qilinmagan, vaqti kelgan) yangi lidlar. */
  waiting: number;
  /** Eng eskisi necha daqiqa kutyapti; navbat bo‘sh — null. */
  oldestMinutes: number | null;
}

/** BE-36: gateway so‘rov chegarasi qayerda sanalmoqda. */
export interface RateLimitHealth {
  /** `REDIS_URL` berilganmi (bir nechta gateway nusxasi uchun umumiy limit). */
  redisConfigured: boolean;
  /** `redis` — umumiy hisob; `memory` — shu nusxa xotirasi (Redis berilmagan yoki uzilgan). */
  store: 'redis' | 'memory';
}

export class OpsHealthDto {
  @ApiProperty({
    example: 2,
    nullable: true,
    type: Number,
    description:
      'Oxirgi 5 daqiqadagi Elchi API xatolari; null — servis javob bermadi',
  })
  elchiApiErrors5m: number | null;

  @ApiProperty({
    example: { waiting: 12, oldestMinutes: 4 },
    nullable: true,
    description: 'Operator navbati; null — servis javob bermadi',
  })
  leadQueue: LeadQueueStats | null;

  @ApiProperty({
    example: { redisConfigured: true, store: 'redis' },
    description:
      'BE-36: so‘rov chegarasi; Redis berilgan, lekin `memory` — nusxalar limitni bo‘lishmayapti',
  })
  rateLimit: RateLimitHealth;
}
