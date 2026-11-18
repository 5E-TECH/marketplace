import { Column, Entity, Index } from 'typeorm';
import { AffiliateStreamStatus, BaseEntity, StreamTemplate } from '@app/common';

/** Sotuvchi sahifasi (oqim): bitta sotuvchi, bitta mahsulot, unikal kod (T3, SOT-3). */
@Entity('stream')
@Index('uq_lead_stream_code', ['code'], { unique: true })
@Index('idx_lead_stream_affiliate', ['affiliateId'])
export class Stream extends BaseEntity {
  @Column({ type: 'varchar', length: 32 })
  code: string;

  /** Sahifa yaratilganda bog‘lanadi, keyin o‘zgarmaydi (SOT-3). */
  @Column({ name: 'affiliate_id', type: 'bigint' })
  affiliateId: string;

  @Column({ name: 'product_id', type: 'bigint' })
  productId: string;

  /** So‘m; tasdiqlangan narxdan +10% gacha (NRX-4), tekshiruv BE-11 da. */
  @Column({ name: 'sale_price', type: 'bigint' })
  salePrice: string;

  @Column({
    type: 'varchar',
    length: 10,
    default: AffiliateStreamStatus.ACTIVE,
  })
  status: AffiliateStreamStatus;

  @Column({ type: 'varchar', length: 10, default: StreamTemplate.STANDART })
  template: StreamTemplate;

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

  @Column({
    name: 'meta_pixel_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  metaPixelId: string | null;

  @Column({
    name: 'tiktok_pixel_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  tiktokPixelId: string | null;

  @Column({ name: 'postback_url', type: 'text', nullable: true })
  postbackUrl: string | null;

  /** AES-GCM bilan shifrlangan; javobda qaytmaydi (BE-11). */
  @Column({ name: 'postback_secret_enc', type: 'text', nullable: true })
  postbackSecretEnc: string | null;

  /** AES-GCM bilan shifrlangan; javobda qaytmaydi (BE-11). */
  @Column({ name: 'capi_token_enc', type: 'text', nullable: true })
  capiTokenEnc: string | null;

  /** Firibgarlik markazi sahifani to‘xtatgan vaqt (BE-35). Sotuvchi bloki olinganda bunday sahifa qayta ochilmaydi. */
  @Column({ name: 'fraud_stopped_at', type: 'timestamptz', nullable: true })
  fraudStoppedAt: Date | null;
}
