import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { LegacyRole, Role } from '../enums';

/** JWT payload (req.user) — token ichidagi ma'lumot. */
export interface JwtUser {
  sub: string; // user id
  role: Role; // BE-05: tokenda do‘kon (shopId) yo‘q
  impersonatedBy?: string; // C6.5: foydalanuvchi nomidan kirgan SUPERADMIN id'si
  tokenType?: 'access' | 'impersonation';
  authVersion?: number; // C6.5: eski access tokenni darhol bekor qilish versiyasi
  iat?: number;
  exp?: number;
}

/**
 * BE-05: eski ochiq xaridor yo‘llari (savat, sevimlilar, eski checkout, buyurtma kuzatuvi) tokendagi foydalanuvchini
 * xaridor deb qabul qilardi. Mijoz endi foydalanuvchi emas: faqat `LegacyRole.BUYER` (bazada bunday rol yo‘q) xaridor
 * bo‘ladi, sotuvchi yoki xodim tokeni bilan so‘rov mehmon (`x-session-id`) sifatida ishlaydi. Yo‘llar BE-18/BE-29 da yopiladi.
 */
export function legacyBuyer(user?: JwtUser): JwtUser | undefined {
  return (user?.role as string | undefined) === LegacyRole.BUYER
    ? user
    : undefined;
}

/** Controller'da joriy foydalanuvchini olish: `@CurrentUser() user: JwtUser`. */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user: JwtUser = req.user;
    return data ? user?.[data] : user;
  },
);
