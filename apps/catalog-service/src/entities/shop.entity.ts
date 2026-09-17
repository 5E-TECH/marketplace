import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity, numericTransformer, ShopStatus } from '@app/common';
import { Product } from './product.entity';

@Entity('shop')
@Index('uq_catalog_shop_owner_user_id', ['ownerUserId'], { unique: true })
@Index('uq_catalog_shop_slug', ['slug'], { unique: true })
export class Shop extends BaseEntity {
  @Column({ name: 'owner_user_id', type: 'bigint' })
  ownerUserId: string;

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

  @Column({
    name: 'tariff_home',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 25000,
    transformer: numericTransformer,
  })
  tariffHome: number;

  @Column({
    name: 'tariff_center',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 15000,
    transformer: numericTransformer,
  })
  tariffCenter: number;

  @Column({ type: 'text', nullable: true })
  address: string | null;

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
