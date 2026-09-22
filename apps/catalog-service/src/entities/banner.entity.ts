import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** C6.9 — storefront bosh sahifasidagi reklama banneri. */
@Entity('banner')
@Index('idx_catalog_banner_sort', ['sortOrder', 'id'])
export class Banner {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;

  @Column({ type: 'varchar', length: 255 }) title: string;

  @Column({ name: 'image_url', type: 'varchar', length: 1000 })
  imageUrl: string;

  @Column({ name: 'link_url', type: 'varchar', length: 1000, nullable: true })
  linkUrl: string | null;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** null — darhol boshlanadi. */
  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  /** null — muddatsiz. */
  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
