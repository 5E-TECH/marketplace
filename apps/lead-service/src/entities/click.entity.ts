import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadVariant } from '@app/common';

/** Sotuvchi sahifasiga o‘tish (T3). Faqat qo‘shiladi, o‘zgarmaydi. */
@Entity('click')
@Index('idx_lead_click_stream_created', ['streamId', 'createdAt'])
export class Click {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'stream_id', type: 'bigint' })
  streamId: string;

  /** S1/S3 sinovi varianti; sotuvchiga ko‘rsatilmaydi (LID-8). */
  @Column({ type: 'varchar', length: 2, nullable: true })
  variant: LeadVariant | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sub1: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sub2: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sub3: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sub4: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sub5: string | null;

  @Column({ name: 'utm_source', type: 'varchar', length: 255, nullable: true })
  utmSource: string | null;

  @Column({ name: 'utm_medium', type: 'varchar', length: 255, nullable: true })
  utmMedium: string | null;

  @Column({
    name: 'utm_campaign',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  utmCampaign: string | null;

  @Column({ name: 'utm_content', type: 'varchar', length: 255, nullable: true })
  utmContent: string | null;

  @Column({ name: 'utm_term', type: 'varchar', length: 255, nullable: true })
  utmTerm: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  fbclid: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fbp: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fbc: string | null;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
