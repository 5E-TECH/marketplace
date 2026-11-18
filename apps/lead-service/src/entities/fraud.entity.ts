import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FraudActionType, FraudIncidentStatus, FraudRule } from '@app/common';

/**
 * Firibgarlik hodisasi (ADM-4, TZ 7-bo‘lim; BE-35). Bir qoida va bir obyekt (`subject_key`: `stream:9`, `lead:55`,
 * `ip:…`, `phone:…`) uchun bir vaqtda bitta ochiq hodisa — takroriy aniqlash dalilni yangilaydi.
 */
@Entity('fraud_incident')
@Index('idx_lead_fraud_incident_status_detected', ['status', 'detectedAt'])
export class FraudIncident {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;

  @Column({ type: 'varchar', length: 24 }) rule: FraudRule;

  @Column({ type: 'varchar', length: 12, default: FraudIncidentStatus.OPEN })
  status: FraudIncidentStatus;

  @Column({ name: 'subject_key', type: 'varchar', length: 80 })
  subjectKey: string;

  @Column({ name: 'affiliate_id', type: 'bigint', nullable: true })
  affiliateId: string | null;

  @Column({ name: 'stream_id', type: 'bigint', nullable: true })
  streamId: string | null;

  @Column({ name: 'lead_id', type: 'bigint', nullable: true })
  leadId: string | null;

  @Column({ name: 'operator_id', type: 'bigint', nullable: true })
  operatorId: string | null;

  @Column({ type: 'text' }) summary: string;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  evidence: Record<string, unknown>;

  @Column({
    name: 'proposed_action',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  proposedAction: FraudActionType | null;

  @Column({ name: 'detected_by', type: 'bigint', nullable: true })
  detectedBy: string | null;

  @CreateDateColumn({ name: 'detected_at', type: 'timestamptz' })
  detectedAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'closed_by', type: 'bigint', nullable: true })
  closedBy: string | null;
}

/**
 * Choralar tarixi (TZ 7: «Har qaror sababi va dalili bilan jurnalga yoziladi»). Faqat qo‘shiladi: o‘zgartirish va
 * o‘chirish triggerda taqiqlangan. `actor_id` bo‘sh — tizim.
 */
@Entity('fraud_action')
@Index('idx_lead_fraud_action_created', ['createdAt'])
@Index('idx_lead_fraud_action_target', ['targetType', 'targetId'])
export class FraudAction {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;

  @Column({ name: 'incident_id', type: 'bigint', nullable: true })
  incidentId: string | null;

  @Column({ type: 'varchar', length: 16 }) action: FraudActionType;

  @Column({ type: 'varchar', length: 24, nullable: true })
  rule: FraudRule | null;

  @Column({ name: 'target_type', type: 'varchar', length: 12 })
  targetType: 'AFFILIATE' | 'STREAM' | 'LEAD' | 'OPERATOR' | 'PHONE' | 'IP';

  @Column({ name: 'target_id', type: 'varchar', length: 64 })
  targetId: string;

  @Column({ name: 'affiliate_id', type: 'bigint', nullable: true })
  affiliateId: string | null;

  @Column({ type: 'text' }) reason: string;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  evidence: Record<string, unknown>;

  @Column({ name: 'actor_id', type: 'bigint', nullable: true })
  actorId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
