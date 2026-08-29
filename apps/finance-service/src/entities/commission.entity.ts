import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CommissionType, numericTransformer } from '@app/common';

@Entity('commission')
export class Commission {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'shop_id', type: 'bigint', nullable: true })
  shopId: string | null;

  @Column({ name: 'category_id', type: 'bigint', nullable: true })
  categoryId: string | null;

  @Column({ type: 'varchar', length: 10, default: CommissionType.PERCENT })
  type: CommissionType;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  value: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
