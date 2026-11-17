import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

/** Postback va Meta CAPI yuborish navbati uchun umumiy ustunlar (T3). Yuborish M2 da (BE-14, BE-31). */
abstract class DeliveryRow extends BaseEntity {
  @Column({ name: 'lead_id', type: 'bigint' })
  leadId: string;

  @Column({ name: 'stream_id', type: 'bigint' })
  streamId: string;

  @Column({ type: 'varchar', length: 32 })
  event: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ name: 'response_code', type: 'int', nullable: true })
  responseCode: number | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;
}

@Entity('postback_delivery')
@Index('uq_lead_postback_delivery_lead_event', ['leadId', 'event'], {
  unique: true,
})
export class PostbackDelivery extends DeliveryRow {}

@Entity('capi_delivery')
@Index('uq_lead_capi_delivery_lead_event', ['leadId', 'event'], {
  unique: true,
})
export class CapiDelivery extends DeliveryRow {}
