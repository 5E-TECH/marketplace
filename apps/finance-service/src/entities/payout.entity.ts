import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinancePayoutStatus, numericTransformer } from '@app/common';

@Entity('payout')
@Index('uq_payout_reference', ['referenceId'], { unique: true })
export class Payout {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'shop_id', type: 'bigint' })
  shopId: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({
    type: 'varchar',
    length: 15,
    default: FinancePayoutStatus.PENDING,
  })
  status: FinancePayoutStatus;

  @Column({ type: 'varchar', length: 30, nullable: true })
  method: string | null;

  @Column({ name: 'reference_id', type: 'varchar', length: 255 })
  referenceId: string;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
