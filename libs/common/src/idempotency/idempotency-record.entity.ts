import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Idempotency yozuvi — bir `key` bilan amal faqat bir marta bajarilishini ta'minlaydi.
 * Takror so'rov kelsa, saqlangan natija qaytariladi (qayta bajarilmaydi).
 */
@Entity('idempotency_record')
export class IdempotencyRecord {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  key: string;

  @Column({ type: 'jsonb', nullable: true })
  response: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
