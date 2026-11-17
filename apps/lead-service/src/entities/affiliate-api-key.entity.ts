import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

/** Sotuvchi lid API si kaliti (T3). Faqat xeshi saqlanadi; API M2 da (BE-43, SOT-6). */
@Entity('affiliate_api_key')
@Index('uq_lead_affiliate_api_key_hash', ['keyHash'], { unique: true })
@Index('idx_lead_affiliate_api_key_affiliate', ['affiliateId'])
export class AffiliateApiKey extends BaseEntity {
  @Column({ name: 'affiliate_id', type: 'bigint' })
  affiliateId: string;

  @Column({ name: 'key_hash', type: 'varchar', length: 128 })
  keyHash: string;

  /** Daqiqasiga so‘rovlar (SOT-6: 60). */
  @Column({ name: 'rate_limit_per_minute', type: 'int', default: 60 })
  rateLimitPerMinute: number;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;
}
