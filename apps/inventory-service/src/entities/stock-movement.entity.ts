import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity, StockMovementType } from '@app/common';
import { Stock } from './stock.entity';

/**
 * Append-only (faqat INSERT) jurnal — har bir qoldiq o'zgarishi bu yerga
 * yoziladi. Loyiha konvensiyasi bo'yicha (MARKETPLACE_PLAN §5) BaseEntity'dan
 * meros oladi; ammo yozuvlar hech qachon yangilanmaydi/o'chirilmaydi, shu bois
 * `updatedAt` amalda `createdAt` bilan teng qoladi va `isDeleted` ishlatilmaydi.
 */
@Entity('stock_movement')
export class StockMovement extends BaseEntity {
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
}
