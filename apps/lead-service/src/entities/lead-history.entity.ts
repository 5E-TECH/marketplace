import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadStatus } from '@app/common';

/**
 * Lid tarixi (T3: eski va yangi holat, kim, qachon). `field`/`old_value`/`new_value` —
 * manzil tuzatilganini yozish uchun (BE-38) [taklif]. `actor_id` bo‘sh — tizim.
 */
@Entity('lead_history')
@Index('idx_lead_lead_history_lead_created', ['leadId', 'createdAt'])
export class LeadHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'lead_id', type: 'bigint' })
  leadId: string;

  @Column({ name: 'from_status', type: 'varchar', length: 12, nullable: true })
  fromStatus: LeadStatus | null;

  @Column({ name: 'to_status', type: 'varchar', length: 12 })
  toStatus: LeadStatus;

  @Column({ name: 'actor_id', type: 'bigint', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  field: string | null;

  @Column({ name: 'old_value', type: 'jsonb', nullable: true })
  oldValue: Record<string, unknown> | null;

  @Column({ name: 'new_value', type: 'jsonb', nullable: true })
  newValue: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
