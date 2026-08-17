import { Column, Entity } from 'typeorm';
import { BaseEntity, Role } from '@app/common';

/**
 * Marketplace foydalanuvchisi (seller/buyer/admin). schema/01-identity.sql bilan mos.
 * Elchi pochta user'idan ALOHIDA.
 */
@Entity('users')
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 20 })
  role: Role;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  phone: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ name: 'avatar_url', type: 'varchar', length: 500, nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  /**
   * C1.29 — admin bloklagan (moderatsiya). `is_active`dan ALOHIDA: bloklangan
   * user login qila olmaydi (401). Pending seller (`is_active=false`) esa
   * bloklanmagan bo'lsa login qila oladi.
   */
  @Column({ name: 'is_blocked', type: 'boolean', default: false })
  isBlocked: boolean;

  /** OPERATOR uchun — qaysi do'konga (catalog.shop.id) biriktirilgan. Boshqa rollar: null. */
  @Column({ name: 'shop_id', type: 'bigint', nullable: true })
  shopId: string | null;
}
