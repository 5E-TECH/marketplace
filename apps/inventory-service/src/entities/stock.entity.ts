import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '@app/common';
import { Warehouse } from './warehouse.entity';

@Entity('stock')
@Index('uq_inventory_stock_variant_warehouse', ['variantId', 'warehouseId'], {
  unique: true,
})
export class Stock extends BaseEntity {
  @Column({ name: 'variant_id', type: 'bigint' })
  variantId: string;

  @Column({ name: 'warehouse_id', type: 'bigint' })
  warehouseId: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Column({ name: 'quantity_on_hand', type: 'integer', default: 0 })
  quantityOnHand: number;

  @Column({ name: 'quantity_reserved', type: 'integer', default: 0 })
  quantityReserved: number;

  @Column({ name: 'low_stock_threshold', type: 'integer', default: 0 })
  lowStockThreshold: number;
}
