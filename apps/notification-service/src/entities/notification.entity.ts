import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('notification')
@Index('idx_notification_user_created', ['userId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** Mijozga SMS da (BE-24) — null: mijoz tizim foydalanuvchisi emas. */
  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  userId: string | null;

  /** BE-24: bir hodisaga bir xabar (masalan `order:<id>:CONFIRMED`). */
  @Column({ name: 'dedupe_key', type: 'varchar', length: 120, nullable: true })
  dedupeKey: string | null;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  data: Record<string, unknown>;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
