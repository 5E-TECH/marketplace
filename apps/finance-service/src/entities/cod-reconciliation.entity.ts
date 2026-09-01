import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '@app/common';

@Entity('cod_reconciliation')
@Index('uq_finance_cod_recon_seller_order', ['sellerOrderId'], { unique: true })
@Index('idx_finance_cod_recon_shop_settled', ['shopId', 'settledAt'])
export class CodReconciliation {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ name: 'event_id', type: 'varchar', length: 128, unique: true })
  eventId: string;
  @Column({ name: 'seller_order_id', type: 'bigint' }) sellerOrderId: string;
  @Column({ name: 'sales_order_id', type: 'bigint' }) salesOrderId: string;
  @Column({ name: 'shop_id', type: 'bigint' }) shopId: string;
  @Column({
    name: 'expected_cod_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  expectedCodAmount: number;
  @Column({
    name: 'collected_cod_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  collectedCodAmount: number;
  @Column({
    name: 'commission_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  commissionAmount: number;
  @Column({
    name: 'netted_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  nettedAmount: number;
  @Column({ name: 'settled_at', type: 'timestamptz' }) settledAt: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
