import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../database/base.entity';

/**
 * Audit izi — kim, nima, qaysi resursda o'zgartirdi.
 * Muhim amallarda (approve, rotate, adjust ...) yoziladi.
 */
@Entity('activity_log')
@Index(['entityType', 'entityId'])
export class ActivityLog extends BaseEntity {
  @Column({ name: 'actor_id', type: 'bigint', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 100 })
  action: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 100, nullable: true })
  entityType: string | null;

  @Column({ name: 'entity_id', type: 'varchar', length: 100, nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  meta: unknown;
}
