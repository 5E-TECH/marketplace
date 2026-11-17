import { Column, Entity, Index } from 'typeorm';
import {
  BaseEntity,
  CheckoutDeliveryDestination,
  LeadRejectReason,
  LeadReviewReason,
  LeadSource,
  LeadStatus,
  LeadOrderStatus,
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
@Index('idx_lead_lead_ip_created', ['ip', 'createdAt'])
@Index('idx_lead_lead_operator_status', ['operatorId', 'status'], {
  where: '"operator_id" IS NOT NULL',
})
@Index('idx_lead_lead_affiliate_confirmed', ['affiliateId', 'confirmedAt'], {
  where: '"confirmed_at" IS NOT NULL',
})
@Index('idx_lead_lead_affiliate_delivered', ['affiliateId', 'deliveredAt'], {
  where: '"delivered_at" IS NOT NULL',
})
@Index('idx_lead_lead_affiliate_refused', ['affiliateId', 'refusedAt'], {
  where: '"refused_at" IS NOT NULL',
})
@Index('idx_lead_lead_confirmed_by', ['confirmedBy', 'confirmedAt'], {
  where: '"confirmed_by" IS NOT NULL',
})
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

  /** Tekshiruvga tushgan ariza sababi (BE-12 bot himoyasi); bo‘sh — oddiy lid. */
  @Column({
    name: 'review_reason',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  reviewReason: LeadReviewReason | null;

  /** Bron rejalashtirilgan qo‘ng‘iroqdanmi (6-qoida: 5 ta chegaraga kirmaydi). */
  @Column({ name: 'booked_from_callback', type: 'boolean', default: false })
  bookedFromCallback: boolean;

  /** 8-qoida eslatmasi yuborilgan vaqt. */
  @Column({ name: 'callback_reminded_at', type: 'timestamptz', nullable: true })
  callbackRemindedAt: Date | null;

  /** `order.create-failed` (qoldiq yo‘q) bilan navbatga qaytgan vaqt (BE-13 TC8). */
  @Column({ name: 'stock_shortage_at', type: 'timestamptz', nullable: true })
  stockShortageAt: Date | null;

  /** API lidi: qaysi kalit bilan kelgan (BE-43, SOT-6). */
  @Column({ name: 'api_key_id', type: 'bigint', nullable: true })
  apiKeyId: string | null;

  /** API lidi: Idempotency-Key — takror so‘rov o‘sha lidni qaytaradi. */
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  idempotencyKey: string | null;

  /** Tasdiq vaqti va operatori (BE-28). `order.create-failed` da tozalanadi — «Tasdiqlangan» = buyurtmasi bor lid. */
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ name: 'confirmed_by', type: 'bigint', nullable: true })
  confirmedBy: string | null;

  /** Buyurtmaning oxirgi holati `order.status.changed` dan (BE-28; BE-18 yuboradi). */
  @Column({ name: 'order_status', type: 'varchar', length: 20, nullable: true })
  orderStatus: LeadOrderStatus | null;

  /** `order_status` hodisasining vaqti: eskirgan hodisa yangisini bosib ketmaydi. */
  @Column({ name: 'order_status_at', type: 'timestamptz', nullable: true })
  orderStatusAt: Date | null;

  /** Birinchi marta yetkazilgan vaqt (statistikada «Yetkazildi» kuni). */
  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  /** Mijoz posilkani olmagan vaqt (statistikada «Rad» kuni). */
  @Column({ name: 'refused_at', type: 'timestamptz', nullable: true })
  refusedAt: Date | null;

  /** «Kutilmoqda» haqi, so‘m: buyurtma narx nusxasidan sotuvchi haqi + ustamaning 85% i (yetkazilguncha). */
  @Column({ name: 'expected_commission', type: 'bigint', nullable: true })
  expectedCommission: string | null;
}
