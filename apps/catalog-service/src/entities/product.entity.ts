import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity, numericTransformer, ProductStatus } from '@app/common';
import { Category } from './category.entity';
import { ProductVariant } from './product-variant.entity';
import { Shop } from './shop.entity';

@Entity('product')
@Index('uq_catalog_product_shop_slug', ['shopId', 'slug'], { unique: true })
@Index('idx_catalog_product_category_id', ['categoryId'])
export class Product extends BaseEntity {
  @Column({ name: 'shop_id', type: 'bigint' })
  shopId: string;

  @ManyToOne(() => Shop, (shop) => shop.products, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'shop_id' })
  shop: Shop;

  @Column({ name: 'owner_user_id', type: 'bigint' })
  ownerUserId: string;

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
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  price: number;

  @Column({
    name: 'old_price',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
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

  @Column({ type: 'varchar', length: 20, default: ProductStatus.ACTIVE })
  status: ProductStatus;

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
