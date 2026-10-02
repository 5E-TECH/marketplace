import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PayoutScheduleFrequency } from '@app/common';

/** Do'konning payout chastotasi. Qator yo'q — platforma default'i (WEEKLY). */
@Entity('payout_schedule')
@Index('uq_finance_payout_schedule_shop', ['shopId'], { unique: true })
export class PayoutSchedule {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'shop_id', type: 'bigint' })
  shopId: string;

  @Column({ type: 'varchar', length: 10 })
  frequency: PayoutScheduleFrequency;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
