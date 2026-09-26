import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  ACCESS_TOKEN_COOKIE,
  CSRF_HEADER,
  readCookie,
} from '../auth/auth-cookies';
import {
  IGNORE_AUTH_COOKIE_KEY,
  IS_PUBLIC_KEY,
  PROVIDER_CALLBACK_KEY,
} from '../decorators/public.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Authorization: Bearer <jwt> ni, u bo'lmasa HttpOnly `accessToken` cookie'ni
 * tekshiradi. Header ustuvor — impersonation tokeni va Swagger shu orqali.
 * - @Public() bo'lsa — o'tkazadi.
 * - token yo'q/yaroqsiz/muddati tugagan → 401 (UNAUTHENTICATED).
 * - cookie bilan o'zgartiruvchi so'rovda CSRF sarlavhasi yo'q → 403
 *   (@Public() route'da esa cookie e'tiborsiz qoldiriladi — anonim).
 * - to'g'ri bo'lsa → payload'ni req.user ga qo'yadi.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest();
    if (
      isPublic &&
      this.reflector.getAllAndOverride<boolean>(PROVIDER_CALLBACK_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const header: string | undefined = req.headers?.authorization;
    let token: string | undefined;
    if (header) {
      if (!header.startsWith('Bearer ')) {
        throw new UnauthorizedException('Token berilmagan yoki formati xato');
      }
      token = header.slice(7);
    } else if (
      !this.reflector.getAllAndOverride<boolean>(IGNORE_AUTH_COOKIE_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      token = readCookie(req.headers, ACCESS_TOKEN_COOKIE);
      if (
        token &&
        !SAFE_METHODS.has(String(req.method).toUpperCase()) &&
        !req.headers?.[CSRF_HEADER]
      ) {
        if (isPublic) return true;
        throw new ForbiddenException(
          'Cookie bilan so‘rovda X-Requested-With sarlavhasi majburiy',
        );
      }
    }
    if (isPublic && !token) return true;
    if (!token) {
      throw new UnauthorizedException('Token berilmagan yoki formati xato');
    }

    try {
      req.user = this.jwt.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token yaroqsiz yoki muddati tugagan');
    }
  }
}
