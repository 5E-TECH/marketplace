import {
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
} from 'typeorm';

/**
 * Barcha entity'lar uchun umumiy poydevor.
 * - `id`   → BIGSERIAL (JS'da string, aniqlik yo'qolmasin — API_CONTRACT §1.6)
 * - sanalar → TIMESTAMPTZ
 * - `isDeleted` → soft-delete (yozuv o'chirilmaydi, faqat belgilanadi)
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted: boolean;
}
