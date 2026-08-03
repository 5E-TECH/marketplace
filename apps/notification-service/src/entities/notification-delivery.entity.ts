import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum NotificationChannel {
  EMAIL = 'email',
  TELEGRAM = 'telegram',
  SMS = 'sms',
}

export enum DeliveryStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  RETRY = 'RETRY',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

@Entity('notification_delivery')
@Index('idx_notification_delivery_retry', ['status', 'nextRetryAt'])
@Index('uq_notification_delivery_channel', ['notificationId', 'channel'], {
  unique: true,
})
export class NotificationDelivery {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'notification_id', type: 'bigint' })
  notificationId: string;

  @Column({ type: 'varchar', length: 15 })
  channel: NotificationChannel;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recipient: string | null;

  @Column({ type: 'varchar', length: 15, default: DeliveryStatus.PENDING })
  status: DeliveryStatus;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
