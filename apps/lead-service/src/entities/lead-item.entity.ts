import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * BE-34: saytdan ko‘p tovarli lidning tovar qatorlari. `lead.product_id`/`quantity`/`sale_price` — birinchi qator
 * (eski kod va statistika uchun); `position` 0 dan, savat tartibida. Narx — saytdagi (tasdiqlangan) narx, bir dona.
 * BE-45: operator qo‘shimcha tovar qo‘shsa (har qanday manba) — 0-qator lid tovari, qolganlari `is_upsell`.
 */
@Entity('lead_item')
@Index('uq_lead_lead_item_product', ['leadId', 'productId'], { unique: true })
export class LeadItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'lead_id', type: 'bigint' })
  leadId: string;

  @Column({ type: 'int' })
  position: number;

  @Column({ name: 'product_id', type: 'bigint' })
  productId: string;

  @Column({ name: 'product_name', type: 'varchar', length: 255 })
  productName: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ name: 'sale_price', type: 'bigint' })
  salePrice: string;

  /** BE-45: operator qo‘shgan qo‘shimcha tovar (upsell); narx — tasdiqlangan narx. */
  @Column({ name: 'is_upsell', type: 'boolean', default: false })
  isUpsell: boolean;

  @Column({ name: 'added_by', type: 'bigint', nullable: true })
  addedBy: string | null;

  @Column({ name: 'added_at', type: 'timestamptz', nullable: true })
  addedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
