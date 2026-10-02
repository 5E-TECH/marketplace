import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  BroadcastAudience,
  BroadcastChannel,
  BroadcastStatus,
} from '@app/common';

/**
 * C6.8 — ommaviy xabar. `previewToken` noyob: bir xil ko'rib chiqilgan
 * xabarni ikki marta bosish ikki marta yubormaydi. `cursor` — oxirgi
 * yuborilgan foydalanuvchi id'si; servis qayta ishga tushsa shu joydan
 * davom etadi.
 */
@Entity('broadcast')
export class Broadcast {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 10 })
  audience: BroadcastAudience;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  channels: BroadcastChannel[];

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'recipients_count', type: 'integer' })
  recipientsCount: number;

  @Column({ name: 'sent_count', type: 'integer', default: 0 })
  sentCount: number;

  @Column({ type: 'varchar', length: 10, default: 'QUEUED' })
  status: BroadcastStatus;

  @Column({ name: 'preview_token', type: 'varchar', length: 64, unique: true })
  previewToken: string;

  @Column({ type: 'bigint', nullable: true })
  cursor: string | null;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  createdBy: string | null;

  /** Ketma-ket muvaffaqiyatsiz urinishlar; bo'lak yuborilsa nolga qaytadi. */
  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
