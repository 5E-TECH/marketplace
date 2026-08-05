import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@app/common';

@Entity('warehouse')
export class Warehouse extends BaseEntity {
  @Column({ name: 'owner_type', type: 'varchar', length: 10, default: 'SHOP' })
  ownerType: string;

  @Column({ name: 'owner_id', type: 'bigint' })
  ownerId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'region_id', type: 'bigint', nullable: true })
  regionId: string | null;

  @Column({ name: 'district_id', type: 'bigint', nullable: true })
  districtId: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
