import { Column, Entity, Index } from 'typeorm';
import {
  BaseEntity,
  DeliveryDisplayMode,
  moneyTransformer,
  numericTransformer,
  PriceStatus,
} from '@app/common';

export enum PricePolicyScope {
  GLOBAL = 'GLOBAL',
  CATEGORY = 'CATEGORY',
  PRODUCT = 'PRODUCT',
}

const money = (name: string) =>
  Column({
    name,
    type: 'bigint',
    nullable: true,
    transformer: moneyTransformer,
  });
const rate = (name: string, precision: number, scale: number) =>
  Column({
    name,
    type: 'numeric',
    precision,
    scale,
    nullable: true,
    transformer: numericTransformer,
  });

/** BE-09: narx parametrlari (ADM-2). Bo‘sh maydon — yuqori darajadan (global → kategoriya → mahsulot). */
@Entity('price_policy')
export class PricePolicy extends BaseEntity {
  @Column({ type: 'varchar', length: 10 })
  scope: PricePolicyScope;

  @Column({ name: 'scope_id', type: 'bigint', nullable: true })
  scopeId: string | null;

  @money('k_sale70') kSale70: number | null;
  @money('k_sale100') kSale100: number | null;
  @money('target_margin') targetMargin: number | null;
  @rate('tax_rate', 6, 4) taxRate: number | null;
  @rate('payment_rate', 6, 4) paymentRate: number | null;
  @money('call_center_fee') callCenterFee: number | null;
  @rate('affiliate_coef', 6, 3) affiliateCoef: number | null;
  @money('ad_cost') adCost: number | null;
  @rate('markup_cap_percent', 5, 2) markupCapPercent: number | null;

  @Column({
    name: 'delivery_mode',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  deliveryMode: DeliveryDisplayMode | null;

  @money('visible_center') visibleCenter: number | null;
  @money('visible_address') visibleAddress: number | null;

  @Column({ name: 'updated_by', type: 'bigint', nullable: true })
  updatedBy: string | null;
}

/** BE-09 (NRX-7): Elchi tarifi kuchga kirish vaqti bilan; yozuv o‘zgarmaydi, yangisi qo‘shiladi. */
@Entity('elchi_tariff')
@Index('idx_catalog_elchi_tariff_effective', ['effectiveFrom'])
export class ElchiTariffEntity extends BaseEntity {
  @Column({
    name: 'center_base',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  centerBase: number;

  @Column({ name: 'base_weight_grams', type: 'integer' })
  baseWeightGrams: number;

  @Column({
    name: 'per_extra_kg',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  perExtraKg: number;

  @Column({
    name: 'address_extra',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  addressExtra: number;

  @Column({ name: 'effective_from', type: 'timestamptz' })
  effectiveFrom: Date;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  createdBy: string | null;
}

/** BE-09 (NRX-6): narx qarori — kim, qachon, holat, sabab va hisob nusxasi. O‘chirilmaydi. */
@Entity('price_decision')
@Index('idx_catalog_price_decision_product', ['productId', 'createdAt'])
export class PriceDecision extends BaseEntity {
  @Column({ name: 'product_id', type: 'bigint' })
  productId: string;

  @Column({ type: 'bigint', transformer: moneyTransformer })
  price: number;

  @Column({ name: 'base_price', type: 'bigint', transformer: moneyTransformer })
  basePrice: number;

  @Column({
    name: 'affiliate_fee',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  affiliateFee: number;

  @Column({ type: 'bigint', transformer: moneyTransformer })
  recommended: number;

  @Column({ type: 'varchar', length: 10 })
  status: PriceStatus;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'jsonb' })
  calculation: Record<string, unknown>;

  @Column({ name: 'decided_by', type: 'bigint' })
  decidedBy: string;
}
