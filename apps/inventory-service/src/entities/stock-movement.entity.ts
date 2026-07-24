import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StockMovementType } from './inventory.enums';
import { Stock } from './stock.entity';

@Entity('stock_movement')
export class StockMovement {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'stock_id', type: 'bigint' })
  stockId: string;

  @ManyToOne(() => Stock, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'stock_id' })
  stock: Stock;

  @Column({ name: 'variant_id', type: 'bigint' })
  variantId: string;

  @Column({ name: 'warehouse_id', type: 'bigint' })
  warehouseId: string;

  @Column({ type: 'varchar', length: 20 })
  type: StockMovementType;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ name: 'on_hand_after', type: 'integer' })
  onHandAfter: number;

  @Column({ name: 'reserved_after', type: 'integer' })
  reservedAfter: number;

  @Column({
    name: 'reference_type',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  referenceType: string | null;

  @Column({ name: 'reference_id', type: 'bigint', nullable: true })
  referenceId: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'actor_id', type: 'bigint', nullable: true })
  actorId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
