import { numericTransformer } from '@app/common';
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Platformada doim bitta (id=1) yozuv bo'ladi. */
@Entity('platform_settings')
export class PlatformSettings {
  @PrimaryColumn({ type: 'smallint', default: 1 })
  id: number;

  @Column({
    name: 'commission_percent',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  commissionPercent: number;

  @Column({
    name: 'minimum_order_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  minimumOrderAmount: number;

  @Column({ name: 'support_phone', type: 'varchar', length: 13, default: '' })
  supportPhone: string;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
