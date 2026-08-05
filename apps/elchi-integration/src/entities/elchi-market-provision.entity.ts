import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

/**
 * Sotuvchi (shop) uchun Elchi market provisioning holati. Marketplace tomonidagi
 * idempotentlik + retry manbai: bir shop uchun bitta yozuv (unique shop_id).
 *  - `pending` — navbatda
 *  - `done`    — Elchi'da market ochildi, `elchi_market_id` bor, shop yangilandi
 *  - `failed`  — xato; retry cron qayta uradi (Elchi tomoni idempotent, 2x ochilmaydi)
 */
@Entity('elchi_market_provision')
@Index('uq_emp_shop', ['shopId'], { unique: true })
@Index('idx_emp_status', ['status'])
export class ElchiMarketProvision extends BaseEntity {
  @Column({ name: 'shop_id', type: 'bigint' })
  shopId: string;

  @Column({ name: 'elchi_market_id', type: 'bigint', nullable: true })
  elchiMarketId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ name: 'shop_name', type: 'varchar', nullable: true })
  shopName: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;
}
