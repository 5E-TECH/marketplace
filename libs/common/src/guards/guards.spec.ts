import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Role } from '../enums';

// TC3: tokensiz -> 401, noto'g'ri rol -> 403
describe('JwtAuthGuard (TC3 — 401)', () => {
  const reflector = { getAllAndOverride: () => false } as any;
  const jwt = {
    verify: (t: string) => {
      if (t === 'good') return { sub: '1', role: Role.SELLER };
      throw new Error('bad');
    },
  } as any;
  const ctx = (headers: any) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as any;

  it("token yo'q -> UnauthorizedException (401)", () => {
    const guard = new JwtAuthGuard(jwt, reflector);
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it('yaroqsiz token -> 401', () => {
    const guard = new JwtAuthGuard(jwt, reflector);
    expect(() =>
      guard.canActivate(ctx({ authorization: 'Bearer bad' })),
    ).toThrow(UnauthorizedException);
  });

  it("to'g'ri token -> true va req.user to'ladi", () => {
    const req: any = { headers: { authorization: 'Bearer good' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
    expect(new JwtAuthGuard(jwt, reflector).canActivate(context)).toBe(true);
    expect(req.user).toEqual({ sub: '1', role: Role.SELLER });
  });

  it('@Public() -> auth talab qilinmaydi', () => {
    const publicReflector = { getAllAndOverride: () => true } as any;
    const guard = new JwtAuthGuard(jwt, publicReflector);
    expect(guard.canActivate(ctx({}))).toBe(true);
  });
});

describe('RolesGuard (TC3 — 403)', () => {
  const ctx = (role?: Role) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role } : undefined }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as any;

  it("noto'g'ri rol -> ForbiddenException (403)", () => {
    const reflector = { getAllAndOverride: () => [Role.ADMIN] } as any;
    expect(() =>
      new RolesGuard(reflector).canActivate(ctx(Role.SELLER)),
    ).toThrow(ForbiddenException);
  });

  it("to'g'ri rol -> true", () => {
    const reflector = { getAllAndOverride: () => [Role.ADMIN] } as any;
    expect(new RolesGuard(reflector).canActivate(ctx(Role.ADMIN))).toBe(true);
  });

  it('rol talab qilinmasa -> true', () => {
    const reflector = { getAllAndOverride: () => undefined } as any;
    expect(new RolesGuard(reflector).canActivate(ctx(Role.BUYER))).toBe(true);
  });
});
