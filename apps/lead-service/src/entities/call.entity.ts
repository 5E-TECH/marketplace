import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  CallChannel,
  CallEndReason,
  CallStatus,
  OperatorPhoneKind,
} from '@app/common';

/** Qo‘ng‘iroq (BE-15; TZ T4 `call`). Mijoz raqami saqlanmaydi — faqat xesh; yozuv provayderda (TEL-6, EQ-02). */
@Entity('call')
@Index('idx_lead_call_lead', ['leadId', 'id'])
@Index('idx_lead_call_operator', ['operatorId', 'requestedAt'])
@Index('idx_lead_call_requested', ['requestedAt'])
export class Call {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** Provayderga beriladigan kalit — hodisalar shu bilan keladi. */
  @Column({ type: 'uuid', unique: true })
  ref: string;

  @Column({ name: 'lead_id', type: 'bigint' })
  leadId: string;

  @Column({ name: 'operator_id', type: 'bigint' })
  operatorId: string;

  @Column({ name: 'attempt_id', type: 'bigint', nullable: true })
  attemptId: string | null;

  @Column({ type: 'varchar', length: 3, default: 'OUT' })
  direction: 'OUT' | 'IN';

  @Column({ type: 'varchar', length: 10 })
  channel: CallChannel;

  @Column({
    name: 'platform_number',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  platformNumber: string | null;

  @Column({ name: 'customer_phone_hash', type: 'varchar', length: 64 })
  customerPhoneHash: string;

  @Column({
    name: 'provider_call_id',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  providerCallId: string | null;

  @Column({ type: 'varchar', length: 16 })
  status: CallStatus;

  @Column({
    name: 'requested_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  requestedAt: Date;

  @Column({ name: 'answered_at', type: 'timestamptz', nullable: true })
  answeredAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds: number | null;

  @Column({
    name: 'end_reason',
    type: 'varchar',
    length: 18,
    nullable: true,
  })
  endReason: CallEndReason | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  failure: string | null;

  @Column({ name: 'hangup_requested_at', type: 'timestamptz', nullable: true })
  hangupRequestedAt: Date | null;

  @Column({
    name: 'recording_ref',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  recordingRef: string | null;

  @Column({ name: 'recording_ready_at', type: 'timestamptz', nullable: true })
  recordingReadyAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** Operatorning telefoni: provayder avval shunga, keyin mijozga qo‘ng‘iroq qiladi (T6; ega qarori 2026-11-23). */
@Entity('operator_phone')
export class OperatorPhone {
  @PrimaryColumn({ name: 'operator_id', type: 'bigint' })
  operatorId: string;

  @Column({ type: 'varchar', length: 10 })
  kind: OperatorPhoneKind;

  @Column({ type: 'varchar', length: 20 })
  value: string;

  @Column({ name: 'updated_by', type: 'bigint' })
  updatedBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
