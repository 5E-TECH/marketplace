import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Authorization: Bearer <jwt> ni tekshiradi.
 * - @Public() bo'lsa — o'tkazadi.
 * - token yo'q/yaroqsiz/muddati tugagan → 401 (UNAUTHENTICATED).
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
    const header: string | undefined = req.headers?.authorization;
    if (isPublic && !header) return true;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token berilmagan yoki formati xato');
    }

    try {
      req.user = this.jwt.verify(header.slice(7));
      return true;
    } catch {
      throw new UnauthorizedException('Token yaroqsiz yoki muddati tugagan');
    }
  }
}
