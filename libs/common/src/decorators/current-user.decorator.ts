import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '../enums';

/** JWT payload (req.user) — token ichidagi ma'lumot. */
export interface JwtUser {
  sub: string; // user id
  role: Role;
  shopId?: string; // SELLER (owner) yoki OPERATOR do'kon scope'i
  impersonatedBy?: string; // C6.5: foydalanuvchi nomidan kirgan SUPERADMIN id'si
  tokenType?: 'access' | 'impersonation';
  authVersion?: number; // C6.5: eski access tokenni darhol bekor qilish versiyasi
  iat?: number;
  exp?: number;
}

/** Controller'da joriy foydalanuvchini olish: `@CurrentUser() user: JwtUser`. */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user: JwtUser = req.user;
    return data ? user?.[data] : user;
  },
);
