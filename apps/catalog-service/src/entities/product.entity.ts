import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import {
  BaseEntity,
  moneyTransformer,
  numericTransformer,
  PriceStatus,
  ProductStatus,
} from '@app/common';
import { Category } from './category.entity';
import { ProductVariant } from './product-variant.entity';
import { Shop } from './shop.entity';

@Entity('product')
// BE-07: slug global unikal (sotuvchi sahifasi va offerlar bitta katalogda)
@Index('uq_catalog_product_slug', ['slug'], { unique: true })
@Index('idx_catalog_product_category_id', ['categoryId'])
export class Product extends BaseEntity {
  @Column({ name: 'shop_id', type: 'bigint' })
  shopId: string;

  @ManyToOne(() => Shop, (shop) => shop.products, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shop_id' })
  shop: Shop;

  /** Eski sotuvchi egasi; BE-07 dan optovik foydalanuvchisiz bo‘lishi mumkin — bo‘sh. */
  @Column({ name: 'owner_user_id', type: 'bigint', nullable: true })
  ownerUserId: string | null;

  @Column({ name: 'category_id', type: 'bigint', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => Category, (category) => category.products, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'category_id' })
  category: Category | null;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'bigint',
    transformer: moneyTransformer,
  })
  price: number;

  @Column({
    name: 'old_price',
    type: 'bigint',
    nullable: true,
    transformer: moneyTransformer,
  })
  oldPrice: number | null;

  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  imageUrl: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  images: string[];

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  attributes: Record<string, unknown>;

  @Column({ name: 'has_variants', type: 'boolean', default: false })
  hasVariants: boolean;

  /** BE-07: yangi mahsulot `PENDING_REVIEW`, sotuvga faqat admin tasdig‘i bilan (`ACTIVE`). */
  @Column({
    type: 'varchar',
    length: 20,
    default: ProductStatus.PENDING_REVIEW,
  })
  status: ProductStatus;

  /** Admin rad etgan sabab (`REJECTED`). */
  @Column({ name: 'moderation_note', type: 'text', nullable: true })
  moderationNote: string | null;

  /** OPT-2: optovikning bazaviy narxi (B), butun so‘m (TZ 2.1). */
  @Column({
    name: 'base_price',
    type: 'bigint',
    nullable: true,
    transformer: moneyTransformer,
  })
  basePrice: number | null;

  /** Sotuvchi haqi (A), so‘mda, har offer uchun (TZ 1-bo‘lim 8-qaror). */
  @Column({
    name: 'affiliate_fee',
    type: 'bigint',
    nullable: true,
    transformer: moneyTransformer,
  })
  affiliateFee: number | null;

  /** OPT-2, BUY-4: bir dona og‘irligi, gramm. Yangi mahsulotda majburiy. */
  @Column({ name: 'weight_grams', type: 'integer', nullable: true })
  weightGrams: number | null;

  /** OPT-2, BUY-4: o‘lchamlar, mm. Yangi mahsulotda majburiy. */
  @Column({ name: 'length_mm', type: 'integer', nullable: true })
  lengthMm: number | null;

  @Column({ name: 'width_mm', type: 'integer', nullable: true })
  widthMm: number | null;

  @Column({ name: 'height_mm', type: 'integer', nullable: true })
  heightMm: number | null;

  /** Offer sotuvchilarga ochiq (admin o‘chirishi mumkin). CPA mahsulotida aniq bitta faol variant. */
  @Column({ name: 'cpa_enabled', type: 'boolean', default: true })
  cpaEnabled: boolean;

  /** BE-09 (NRX-6): admin tasdiqlagan narx — mijoz ko‘radigan tovar narxi (yashirilgan yetkazish bilan). */
  @Column({
    name: 'approved_price',
    type: 'bigint',
    nullable: true,
    transformer: moneyTransformer,
  })
  approvedPrice: number | null;

  /** Oxirgi narx qarorining holati (GREEN, YELLOW, ORANGE). */
  @Column({ name: 'price_status', type: 'varchar', length: 10, nullable: true })
  priceStatus: PriceStatus | null;

  /** NRX-5: raqobatchida mijoz jami to‘laydigan summa — ustama chegarasi undan oshmaydi (NRX-4). */
  @Column({
    name: 'market_total',
    type: 'bigint',
    nullable: true,
    transformer: moneyTransformer,
  })
  marketTotal: number | null;

  /** BAD (dori vositasi emas) — admin qo‘yadi (ADM-1); sotuvchi sahifasi ogohlantirishni shundan ko‘rsatadi. */
  @Column({ name: 'is_bad', type: 'boolean', default: false })
  isBad: boolean;

  @Column({ name: 'is_blocked', type: 'boolean', default: false })
  isBlocked: boolean;

  /** BE-27: yashirish sababi (`POST /admin/products/:id/hide`); qayta ochilganda tozalanadi. */
  @Column({
    name: 'block_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  blockReason: string | null;

  @Column({
    type: 'numeric',
    precision: 3,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  rating: number;

  @OneToMany(() => ProductVariant, (variant) => variant.product)
  variants: ProductVariant[];
}
