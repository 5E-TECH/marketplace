import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

/** Offer matnlari (BE-11): admin kiritadi (FE-12), sotuvchi sahifasi va operator kartasi ko‘rsatadi. */
@Entity('offer_content')
@Index('uq_lead_offer_content_product', ['productId'], { unique: true })
export class OfferContent extends BaseEntity {
  @Column({ name: 'product_id', type: 'bigint' })
  productId: string;

  @Column({ name: 'call_script', type: 'text', nullable: true })
  callScript: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  highlights: string[];

  @Column({ name: 'box_contents', type: 'jsonb', default: () => "'[]'::jsonb" })
  boxContents: string[];

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  updatedBy: string | null;
}
