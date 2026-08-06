import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

/**
 * Elchi geo (viloyat/tuman) keshi — marketplace manzilini Elchi region/district
 * id'ga moslash uchun. Elchi Partner API (`GET /partner/regions|districts`)dan
 * sinxronlanadi. `kind` = 'region' | 'district'; district uchun `elchi_region_id`.
 */
@Entity('geo_cache')
@Index('uq_geo_kind_elchi', ['kind', 'elchiId'], { unique: true })
@Index('idx_geo_region', ['elchiRegionId'])
export class GeoCache extends BaseEntity {
  @Column({ type: 'varchar', length: 10 })
  kind: string;

  @Column({ name: 'elchi_id', type: 'bigint' })
  elchiId: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ name: 'elchi_region_id', type: 'bigint', nullable: true })
  elchiRegionId: string | null;
}
