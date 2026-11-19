import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClientProxy } from '@nestjs/microservices';
import { IS_PUBLIC_KEY, JwtUser, RmqClient, sendRpc } from '@app/common';

export const ALLOW_STALE_TOKEN_KEY = 'allowStaleToken';
/**
 * Token yaroqli (imzo, muddat), lekin eskirgan bo‘lsa ham (bloklangan, rol yoki parol o‘zgargan) ishlaydigan yo‘l.
 * Faqat logout uchun: bloklangan foydalanuvchi ham chiqib, HttpOnly cookie'larini tozalay olsin (BE-05).
 */
export const AllowStaleToken = () => SetMetadata(ALLOW_STALE_TOKEN_KEY, true);

/**
 * C6.5 — JWT ichidagi rol/versiyani joriy DB holati bilan tekshiradi. Rol yoki authVersion o'zgargan (masalan,
 * bloklangan) foydalanuvchining eski access tokeni darhol 401 oladi.
 * BE-05: `@Roles` bo‘lmagan yopiq yo‘llarda ham (profil, sessiyalar, bildirishnomalar, murojaatlar) — bloklangan
 * foydalanuvchi ular orqali ham ishlay olmaydi. `@Public` yo‘llarda token ixtiyoriy, tekshirilmaydi.
 */
@Injectable()
export class CurrentRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(ALLOW_STALE_TOKEN_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtUser | undefined;
    if (!user?.sub) return true; // tokensiz yopiq yo‘lni JwtAuthGuard allaqachon 401 qilgan
    await sendRpc(
      this.identity,
      { cmd: 'identity.user.authorize-token' },
      {
        userId: user.sub,
        role: user.role,
        authVersion: user.authVersion,
      },
    );
    return true;
  }
}
