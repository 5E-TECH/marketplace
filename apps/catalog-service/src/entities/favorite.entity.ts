import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('favorite')
@Index('uq_catalog_favorite_user_product', ['userId', 'productId'], {
  unique: true,
  where: '"user_id" IS NOT NULL',
})
@Index('uq_catalog_favorite_session_product', ['sessionId', 'productId'], {
  unique: true,
  where: '"session_id" IS NOT NULL',
})
@Index('idx_catalog_favorite_user_created', ['userId', 'createdAt'])
@Index('idx_catalog_favorite_session_created', ['sessionId', 'createdAt'])
export class Favorite {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'user_id', type: 'bigint', nullable: true }) userId:
    string | null;
  @Column({ name: 'session_id', type: 'varchar', length: 128, nullable: true })
  sessionId: string | null;
  @Column({ name: 'product_id', type: 'bigint' }) productId: string;
  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
