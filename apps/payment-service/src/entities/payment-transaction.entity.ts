import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '@app/common';
import { Payment } from './payment.entity';

@Entity('payment_transaction')
export class PaymentTransaction {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'payment_id', type: 'bigint' })
  paymentId: string;

  @ManyToOne(() => Payment, (payment) => payment.transactions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;

  @Column({
    name: 'provider_txn_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  providerTxnId: string | null;

  @Column({ type: 'integer', nullable: true })
  state: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  action: string | null;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  amount: number | null;

  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
