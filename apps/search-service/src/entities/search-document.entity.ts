import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '@app/common';

@Entity('search_document')
@Index('uq_search_document_product_id', ['productId'], { unique: true })
@Index('idx_search_document_category_id', ['categoryId'])
@Index('idx_search_document_price', ['price'])
export class SearchDocument {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'product_id', type: 'bigint' }) productId: string;
  @Column({ name: 'shop_id', type: 'bigint' }) shopId: string;
  @Column({ name: 'category_id', type: 'bigint', nullable: true })
  categoryId: string | null;
  @Column({ type: 'varchar', length: 255 }) title: string;
  @Column({ type: 'text', nullable: true }) content: string | null;
  @Column({ type: 'varchar', length: 255 }) slug: string;
  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  imageUrl: string | null;
  @Column({ name: 'shop_name', type: 'varchar', length: 255 }) shopName: string;
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  price: number;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  attributes: Record<string, unknown>;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
