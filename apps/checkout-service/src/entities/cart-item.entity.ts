import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity, numericTransformer } from '@app/common';
import { Cart } from './cart.entity';

@Entity('cart_item')
@Unique('uq_checkout_cart_item_variant', ['cartId', 'variantId'])
export class CartItem extends BaseEntity {
  @Column({ name: 'cart_id', type: 'bigint' }) cartId: string;
  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_id' })
  cart: Cart;
  @Column({ name: 'product_id', type: 'bigint' }) productId: string;
  @Column({ name: 'variant_id', type: 'bigint' }) variantId: string;
  @Column({ name: 'shop_id', type: 'bigint' }) shopId: string;
  @Column({ type: 'integer' }) quantity: number;
  @Column({
    name: 'unit_price_snapshot',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  unitPriceSnapshot: number;
}
