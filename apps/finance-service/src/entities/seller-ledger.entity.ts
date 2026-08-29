import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FinanceLedgerEntryType, numericTransformer } from '@app/common';

@Entity('seller_ledger')
@Index('idx_seller_ledger_shop_created', ['shopId', 'createdAt'])
export class SellerLedger {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'shop_id', type: 'bigint' })
  shopId: string;

  @Column({ name: 'entry_type', type: 'varchar', length: 15 })
  entryType: FinanceLedgerEntryType;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({
    name: 'balance_after',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  balanceAfter: number;

  @Column({ name: 'reference_type', type: 'varchar', length: 30 })
  referenceType: string;

  @Column({ name: 'reference_id', type: 'varchar', length: 255 })
  referenceId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
