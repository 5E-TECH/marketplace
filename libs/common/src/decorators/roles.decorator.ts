import { SetMetadata } from '@nestjs/common';
import { LegacyRole, Role } from '../enums';

export const ROLES_KEY = 'roles';

/**
 * Route'ni faqat berilgan rollar uchun ochadi. Masalan: @Roles(Role.ADMIN). `LegacyRole` — faqat BE-29 da
 * o‘chiriladigan eski yo‘llar uchun (hech kimda bunday rol yo‘q).
 */
export const Roles = (...roles: Array<Role | LegacyRole>) =>
  SetMetadata(ROLES_KEY, roles);

/**
 * BE-05: eski do‘kon yo‘li (BE-29 da o‘chiriladi) — yangi rollarning hech biriga ochilmaydi: faqat bazada yo‘q
 * `LegacyRole` lar. Tokensiz 401, har qanday yangi rol bilan 403.
 */
export const LegacyOnly = () => Roles(...Object.values(LegacyRole));
