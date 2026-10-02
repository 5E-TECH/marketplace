import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * C6.8 — admin tahrirlagan shablon. Standart matn kodda
 * (`notification-templates.ts`); bu yerda faqat o'zgartirilgani saqlanadi.
 * Yozuv o'chirilsa shablon standartga qaytadi.
 */
@Entity('notification_template')
export class NotificationTemplate {
  @PrimaryColumn({ type: 'varchar', length: 50 })
  key: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
