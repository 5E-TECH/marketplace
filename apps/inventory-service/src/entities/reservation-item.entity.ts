import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Reservation } from './reservation.entity';
import { Warehouse } from './warehouse.entity';

@Entity('reservation_item')
@Index(
  'uq_inventory_reservation_item_variant_warehouse',
  ['reservationId', 'variantId', 'warehouseId'],
  { unique: true },
)
export class ReservationItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'reservation_id', type: 'bigint' })
  reservationId: string;

  @ManyToOne(() => Reservation, (reservation) => reservation.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'reservation_id' })
  reservation: Reservation;

  @Column({ name: 'variant_id', type: 'bigint' })
  variantId: string;

  @Column({ name: 'warehouse_id', type: 'bigint' })
  warehouseId: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Column({ type: 'integer' })
  quantity: number;
}
