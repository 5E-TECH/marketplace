import { Column, Entity, Index } from 'typeorm';
import {
  BaseEntity,
  CheckoutDeliveryDestination,
  LeadRejectReason,
  LeadSource,
  LeadStatus,
  LeadVariant,
} from '@app/common';

/**
 * Lid (T3; T02:40 yangi tahriri). Manzil — SOATO (EQ-06), sotuvchi sahifasi va sayt lidida majburiy;
 * operator tasdiqlamaguncha «Tasdiqlandi» bo‘lmaydi (OPR-4, BE-38).
 */
@Entity('lead')
@Index('idx_lead_lead_status_next_attempt', ['status', 'nextAttemptAt'])
@Index('idx_lead_lead_phone_product', ['phoneE164', 'productId'])
@Index('idx_lead_lead_stream_created', ['streamId', 'createdAt'])
@Index('idx_lead_lead_affiliate_created', ['affiliateId', 'createdAt'])
export class Lead extends BaseEntity {
  @Column({ type: 'varchar', length: 10 })
  source: LeadSource;

  @Column({ name: 'stream_id', type: 'bigint', nullable: true })
  streamId: string | null;

  @Column({ name: 'click_id', type: 'bigint', nullable: true })
  clickId: string | null;

  /** Birinchi arizaning sotuvchisi; keyin o‘zgarmaydi (SOT-3, 9-qoida). */
  @Column({ name: 'affiliate_id', type: 'bigint', nullable: true })
  affiliateId: string | null;

  @Column({ name: 'product_id', type: 'bigint' })
  productId: string;

  @Column({ type: 'varchar', length: 12, default: LeadStatus.NEW })
  status: LeadStatus;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'phone_e164', type: 'varchar', length: 16 })
  phoneE164: string;

  @Column({ name: 'region_soato', type: 'varchar', length: 20, nullable: true })
  regionSoato: string | null;

  @Column({
    name: 'district_soato',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  districtSoato: string | null;

  /** Ko‘cha, uy; buyurtmada `delivery_address` bo‘ladi. */
  @Column({
    name: 'address_line',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  addressLine: string | null;

  /** Mijoz tanlagan, operator o‘zgartira oladi (P-1). */
  @Column({
    name: 'where_deliver',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  whereDeliver: CheckoutDeliveryDestination | null;

  @Column({ name: 'address_confirmed_by', type: 'bigint', nullable: true })
  addressConfirmedBy: string | null;

  @Column({ name: 'address_confirmed_at', type: 'timestamptz', nullable: true })
  addressConfirmedAt: Date | null;

  /** S1/S3 sinovi varianti; operator va sotuvchiga ko‘rsatilmaydi (LID-8). */
  @Column({ type: 'varchar', length: 2, nullable: true })
  variant: LeadVariant | null;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  /** So‘m, sahifadagi narx (LID-3). */
  @Column({ name: 'sale_price', type: 'bigint' })
  salePrice: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sub1: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sub2: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sub3: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sub4: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sub5: string | null;

  @Column({ name: 'utm_source', type: 'varchar', length: 255, nullable: true })
  utmSource: string | null;

  @Column({ name: 'utm_medium', type: 'varchar', length: 255, nullable: true })
  utmMedium: string | null;

  @Column({
    name: 'utm_campaign',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  utmCampaign: string | null;

  @Column({ name: 'utm_content', type: 'varchar', length: 255, nullable: true })
  utmContent: string | null;

  @Column({ name: 'utm_term', type: 'varchar', length: 255, nullable: true })
  utmTerm: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  fbclid: string | null;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  /** Mijoz rozi bo‘lgan matn versiyasi va server vaqti (BE-12). */
  @Column({
    name: 'consent_version',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  consentVersion: string | null;

  @Column({ name: 'consent_at', type: 'timestamptz', nullable: true })
  consentAt: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  /** Yaratilgandan 3 kun — «Aloqa bo‘lmadi» (2-qoida). */
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'operator_id', type: 'bigint', nullable: true })
  operatorId: string | null;

  @Column({ name: 'booked_until', type: 'timestamptz', nullable: true })
  bookedUntil: Date | null;

  @Column({ name: 'merged_into_id', type: 'bigint', nullable: true })
  mergedIntoId: string | null;

  @Column({ name: 'order_id', type: 'bigint', nullable: true })
  orderId: string | null;

  @Column({
    name: 'reject_reason',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  rejectReason: LeadRejectReason | null;
}
