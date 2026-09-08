import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ProviderCallback, Public } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
class Routes {
  @Public() publicRoute() {}
  @ProviderCallback() providerRoute() {}
  privateRoute() {}
}
describe('Provider callback authentication boundary', () => {
  const jwt = new JwtService({ secret: 'guard-test-secret' });
  const guard = new JwtAuthGuard(jwt, new Reflector());
  const ctx = (method: keyof Routes, authorization: string) =>
    ({
      getHandler: () => Routes.prototype[method],
      getClass: () => Routes,
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization } }),
      }),
    }) as unknown as ExecutionContext;
  it('provider route delegates Basic authentication to its provider service', () => {
    expect(guard.canActivate(ctx('providerRoute', 'Basic test'))).toBe(true);
  });
  it.each(['publicRoute', 'privateRoute'] as const)(
    '%s keeps JWT validation',
    (method) => {
      expect(() => guard.canActivate(ctx(method, 'Basic test'))).toThrow(
        UnauthorizedException,
      );
      expect(() => guard.canActivate(ctx(method, 'Bearer invalid'))).toThrow(
        UnauthorizedException,
      );
    },
  );
});
