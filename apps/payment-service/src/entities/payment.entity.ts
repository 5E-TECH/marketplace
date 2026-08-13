import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  numericTransformer,
  PaymentProvider,
  PaymentStatus,
} from '@app/common';
import { PaymentTransaction } from './payment-transaction.entity';

@Entity('payment')
@Index('idx_payment_order_provider', ['salesOrderId', 'provider'])
export class Payment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'sales_order_id', type: 'bigint' })
  salesOrderId: string;

  @Column({ type: 'varchar', length: 10 })
  provider: PaymentProvider;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ type: 'varchar', length: 15, default: PaymentStatus.CREATED })
  status: PaymentStatus;

  @Column({
    name: 'external_txn_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  externalTxnId: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => PaymentTransaction, (transaction) => transaction.payment)
  transactions: PaymentTransaction[];
}
