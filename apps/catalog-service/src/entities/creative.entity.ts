import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CreativeType } from '@app/common';

/**
 * Kreativ (BE-08; TZ T4 `catalog.creative`, SOT-9): mahsulot uchun admin yuklagan video yoki rasm. Moderatsiya yo‘q —
 * kreativni faqat admin yuklaydi (FE-12, BE-27). Fayl MinIO da, ochiq havola bilan.
 */
@Entity('creative')
@Index('idx_catalog_creative_product', ['productId', 'position', 'id'])
export class Creative {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;

  @Column({ name: 'product_id', type: 'bigint' }) productId: string;

  @Column({ type: 'varchar', length: 10 }) type: CreativeType;

  @Column({ name: 'object_key', type: 'varchar', length: 300 })
  objectKey: string;

  @Column({ type: 'varchar', length: 1000 }) url: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @Column({
    name: 'size_bytes',
    type: 'bigint',
    transformer: {
      to: (value: number) => value,
      from: (value: string | null) => (value == null ? null : Number(value)),
    },
  })
  sizeBytes: number;

  @Column({ type: 'integer', default: 0 }) position: number;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  createdBy: string | null;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
