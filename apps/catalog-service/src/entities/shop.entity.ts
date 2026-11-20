import { Column, Entity, Index, OneToMany } from 'typeorm';
import {
  BaseEntity,
  numericTransformer,
  ShopStatus,
  WholesalerLegalType,
} from '@app/common';
import { Product } from './product.entity';

/**
 * BE-07: optovik (TZ 6.9). Jadval nomi `shop` qoldi — mahsulot, buyurtma va ombor `shop_id` ga bog‘langan. Ishga
 * tushishda optovikni admin kiritadi, foydalanuvchisiz (`owner_user_id` bo‘sh); o‘zi ro‘yxatdan o‘tishi — BE-30.
 */
@Entity('shop')
@Index('uq_catalog_shop_owner_user_id', ['ownerUserId'], { unique: true })
@Index('uq_catalog_shop_slug', ['slug'], { unique: true })
export class Shop extends BaseEntity {
  @Column({ name: 'owner_user_id', type: 'bigint', nullable: true })
  ownerUserId: string | null;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'logo_url', type: 'varchar', length: 500, nullable: true })
  logoUrl: string | null;

  @Column({ name: 'banner_url', type: 'varchar', length: 500, nullable: true })
  bannerUrl: string | null;

  @Column({ type: 'varchar', length: 20, default: ShopStatus.PENDING })
  status: ShopStatus;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ name: 'region_id', type: 'bigint', nullable: true })
  regionId: string | null;

  @Column({ name: 'district_id', type: 'bigint', nullable: true })
  districtId: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  /** OPT-1: yuridik shaxs yoki YaTT. */
  @Column({ name: 'legal_type', type: 'varchar', length: 20, nullable: true })
  legalType: WholesalerLegalType | null;

  /** OPT-1: STIR (9 raqam). */
  @Column({ type: 'varchar', length: 9, nullable: true })
  tin: string | null;

  @Column({ name: 'bank_name', type: 'varchar', length: 255, nullable: true })
  bankName: string | null;

  /** Hisob raqami (20 raqam). */
  @Column({ name: 'bank_account', type: 'varchar', length: 20, nullable: true })
  bankAccount: string | null;

  /** Bank MFO kodi (5 raqam). */
  @Column({ name: 'bank_mfo', type: 'varchar', length: 5, nullable: true })
  bankMfo: string | null;

  /** OPT-1: komissiya shartnomasi. Shartnomasiz mahsulot qo‘shib bo‘lmaydi. */
  @Column({
    name: 'contract_number',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  contractNumber: string | null;

  @Column({ name: 'contract_date', type: 'date', nullable: true })
  contractDate: string | null;

  @Column({
    type: 'numeric',
    precision: 3,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  rating: number;

  @Column({ name: 'orders_count', type: 'integer', default: 0 })
  ordersCount: number;

  @Column({ name: 'is_featured', type: 'boolean', default: false })
  isFeatured: boolean;

  @Column({ name: 'elchi_market_id', type: 'bigint', nullable: true })
  elchiMarketId: string | null;

  @OneToMany(() => Product, (product) => product.shop)
  products: Product[];
}
