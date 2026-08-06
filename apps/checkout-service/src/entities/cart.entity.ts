import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '@app/common';
import { CartItem } from './cart-item.entity';

@Entity('cart')
export class Cart extends BaseEntity {
  @Column({ name: 'customer_id', type: 'bigint', nullable: true })
  customerId: string | null;

  @Column({ name: 'session_id', type: 'varchar', length: 255, nullable: true })
  sessionId: string | null;

  @Column({ type: 'varchar', length: 15, default: 'active' })
  status: string;

  @OneToMany(() => CartItem, (item) => item.cart)
  items: CartItem[];
}
