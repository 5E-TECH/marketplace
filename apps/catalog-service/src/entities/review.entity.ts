import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from './product.entity';
import { Shop } from './shop.entity';

@Entity('review')
@Index('uq_catalog_review_order_item', ['orderItemId'], { unique: true })
@Index('idx_catalog_review_product_created', ['productId', 'createdAt'])
export class Review {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'user_id', type: 'bigint' }) userId: string;
  @Column({ name: 'order_item_id', type: 'bigint' }) orderItemId: string;
  @Column({ name: 'seller_order_id', type: 'bigint' }) sellerOrderId: string;
  @Column({ name: 'product_id', type: 'bigint' }) productId: string;
  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;
  @Column({ name: 'shop_id', type: 'bigint' }) shopId: string;
  @ManyToOne(() => Shop, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shop_id' })
  shop: Shop;
  @Column({ type: 'smallint' }) rating: number;
  @Column({ type: 'text', nullable: true }) comment: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
