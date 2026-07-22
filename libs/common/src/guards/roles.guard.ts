import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums';

/**
 * @Roles(...) bilan belgilangan route'lar uchun rolni tekshiradi.
 * Rol talab qilinmasa — o'tkazadi. Rol mos kelmasa → 403 (FORBIDDEN).
 * JwtAuthGuard'dan KEYIN ishlaydi (req.user tayyor bo'lishi kerak).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const role: Role | undefined = req.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Bu amal uchun ruxsat yetarli emas');
    }
    return true;
  }
}
