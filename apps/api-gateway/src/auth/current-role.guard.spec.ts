import { ExecutionContext, HttpException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { Role } from '@app/common';
import { CurrentRoleGuard } from './current-role.guard';

describe('CurrentRoleGuard (C6.5)', () => {
  const context = (user: Record<string, unknown>) =>
    ({
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('role-protected route uchun joriy rol va authVersionni tekshiradi', async () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => [Role.SELLER]),
    };
    const send = jest.fn(() => of({ authorized: true }));
    const guard = new CurrentRoleGuard(reflector as never, { send } as never);

    await expect(
      guard.canActivate(
        context({ sub: '42', role: Role.SELLER, authVersion: 3 }),
      ),
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(
      { cmd: 'identity.user.authorize-token' },
      { userId: '42', role: Role.SELLER, authVersion: 3 },
    );
  });

  it('identity eski tokenni rad etsa 401 qaytaradi', async () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => [Role.SELLER]),
    };
    const send = jest.fn(() =>
      throwError(() => ({ status: 401, message: 'Token bekor qilingan' })),
    );
    const guard = new CurrentRoleGuard(reflector as never, { send } as never);

    await expect(
      guard.canActivate(
        context({ sub: '42', role: Role.SELLER, authVersion: 2 }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('@Roles bo‘lmagan route uchun identity servisiga bormaydi', async () => {
    const reflector = { getAllAndOverride: jest.fn(() => undefined) };
    const send = jest.fn();
    const guard = new CurrentRoleGuard(reflector as never, { send } as never);

    await expect(guard.canActivate(context({}))).resolves.toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});
