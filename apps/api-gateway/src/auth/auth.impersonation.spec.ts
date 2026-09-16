import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@app/common';
import { AuthController } from './auth.controller';

describe('AuthController impersonation xavfsizligi (C6.5)', () => {
  it('impersonation rejimida parolni o‘zgartirishni bloklaydi', () => {
    const send = jest.fn();
    const controller = new AuthController(
      { send } as never,
      new JwtService({ secret: 'test-secret' }),
    );

    expect(() =>
      controller.updateProfile(
        {
          sub: '42',
          role: Role.SELLER,
          impersonatedBy: '1',
          tokenType: 'impersonation',
        },
        { password: 'NewSecret123' },
      ),
    ).toThrow(ForbiddenException);
    expect(send).not.toHaveBeenCalled();
  });
});
