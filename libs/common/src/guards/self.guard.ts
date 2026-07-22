import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '../enums';

/**
 * Foydalanuvchi faqat O'Z resursiga tegishini ta'minlaydi (masalan boshqa do'kon
 * profilini tahrirlay olmasin). ADMIN/SUPERADMIN chetlab o'tadi.
 * Standart: route param `:id` yoki `:userId` ni req.user.sub bilan solishtiradi.
 * Murakkab tekshiruv (masalan shop egaligi) servis ichida qilinadi.
 */
@Injectable()
export class SelfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException('Autentifikatsiya talab qilinadi');

    if (user.role === Role.ADMIN || user.role === Role.SUPERADMIN) return true;

    const targetId = req.params?.userId ?? req.params?.id;
    if (targetId && String(targetId) !== String(user.sub)) {
      throw new ForbiddenException('Boshqa foydalanuvchi resursiga ruxsat berilmagan');
    }
    return true;
  }
}
