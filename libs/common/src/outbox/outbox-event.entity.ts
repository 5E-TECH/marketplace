import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../database/base.entity';

export enum OutboxStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}

/**
 * Outbox — event'ni biznes yozuv bilan BITTA tranzaksiyada saqlaydi.
 * Alohida relay keyin uni publish qiladi va PROCESSED belgilaydi.
 * Shu bilan event yo'qolmaydi va faqat BIR MARTA yuboriladi.
 */
@Entity('outbox_event')
@Index(['status'])
export class OutboxEvent extends BaseEntity {
  @Column({ name: 'aggregate_type', type: 'varchar', length: 100 })
  aggregateType: string;

  @Column({ name: 'aggregate_id', type: 'varchar', length: 100 })
  aggregateId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: unknown;

  @Column({ type: 'varchar', length: 15, default: OutboxStatus.PENDING })
  status: OutboxStatus;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
