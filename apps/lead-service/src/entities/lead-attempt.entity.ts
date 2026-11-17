import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadOutcome } from '@app/common';

/** Operator urinishi (T3). Qo‘ng‘iroq ID si va yozuvi telefoniya bilan keladi (BE-15, M2). */
@Entity('lead_attempt')
@Index('idx_lead_lead_attempt_lead_created', ['leadId', 'createdAt'])
export class LeadAttempt {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'lead_id', type: 'bigint' })
  leadId: string;

  @Column({ name: 'operator_id', type: 'bigint' })
  operatorId: string;

  @Column({ name: 'call_id', type: 'varchar', length: 64, nullable: true })
  callId: string | null;

  @Column({ type: 'varchar', length: 12 })
  outcome: LeadOutcome;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ name: 'callback_at', type: 'timestamptz', nullable: true })
  callbackAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
