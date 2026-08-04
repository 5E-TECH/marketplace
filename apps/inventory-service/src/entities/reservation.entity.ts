import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity, ReservationStatus } from '@app/common';
import { ReservationItem } from './reservation-item.entity';

@Entity('reservation')
export class Reservation extends BaseEntity {
  @Column({ name: 'order_ref', type: 'bigint', unique: true })
  orderRef: string;

  @Column({
    type: 'varchar',
    length: 15,
    default: ReservationStatus.HELD,
  })
  status: ReservationStatus;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 255,
    nullable: true,
    unique: true,
  })
  idempotencyKey: string | null;

  @OneToMany(() => ReservationItem, (item) => item.reservation)
  items: ReservationItem[];
}
