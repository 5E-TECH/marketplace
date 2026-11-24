import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, OperatorWorkState } from '@app/common';

/** Operator holati va faol bronlar soni (T3). */
@Entity('operator_state')
@Index('uq_lead_operator_state_operator', ['operatorId'], { unique: true })
export class OperatorState extends BaseEntity {
  @Column({ name: 'operator_id', type: 'bigint' })
  operatorId: string;

  @Column({ type: 'varchar', length: 10, default: OperatorWorkState.OFFLINE })
  state: OperatorWorkState;

  @Column({ name: 'active_bookings', type: 'int', default: 0 })
  activeBookings: number;

  /** BE-25 (FE-08): shu holat qachondan beri — holat o‘zgarganda yangilanadi. */
  @Column({ name: 'state_since', type: 'timestamptz', nullable: true })
  stateSince: Date | null;
}
