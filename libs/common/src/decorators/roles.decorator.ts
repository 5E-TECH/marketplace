import { SetMetadata } from '@nestjs/common';
import { LegacyRole, Role } from '../enums';

export const ROLES_KEY = 'roles';

/**
 * Route'ni faqat berilgan rollar uchun ochadi. Masalan: @Roles(Role.ADMIN). `LegacyRole` — faqat BE-29 da
 * o‘chiriladigan eski yo‘llar uchun (hech kimda bunday rol yo‘q).
 */
export const Roles = (...roles: Array<Role | LegacyRole>) =>
  SetMetadata(ROLES_KEY, roles);
