import { Column, Entity } from 'typeorm';
import { BaseEntity, Role } from '@app/common';

/**
 * Platforma foydalanuvchisi: sotuvchi, optovik yoki xodim (BE-05, TZ 3-bo‘lim). Mijoz foydalanuvchi emas.
 * Elchi pochta user'idan ALOHIDA.
 */
@Entity('users')
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 20 })
  role: Role;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** BE-06: sotuvchi profilidagi ism va familiya (FE-04); `name` — ikkalasidan. */
  @Column({ name: 'first_name', type: 'varchar', length: 100, nullable: true })
  firstName: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 100, nullable: true })
  lastName: string | null;

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

  /** Rol/parol/blok holati o‘zgarganda eski access tokenlarni bekor qiladi. */
  @Column({ name: 'auth_version', type: 'integer', default: 1 })
  authVersion: number;

  /** BE-26: 2FA (TOTP) ulangan vaqt; sir va tiklash kodlari alohida ustunlarda (faqat `TwoFactorService`). */
  @Column({ name: 'totp_enabled_at', type: 'timestamptz', nullable: true })
  totpEnabledAt: Date | null;
}
