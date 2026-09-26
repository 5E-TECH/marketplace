import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { of, throwError } from 'rxjs';
import { AuthController } from './auth.controller';

describe('AuthController — HttpOnly auth cookie’lari', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  const refreshToken = jwt.sign({ sub: '42' }, { expiresIn: '7d' });
  const tokens = { accessToken: 'access-1', refreshToken };
  const request = { secure: true, headers: {} } as never;
  const response = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });

  it('login access va refresh tokenni HttpOnly cookie’ga yozadi', async () => {
    const controller = new AuthController(
      { send: jest.fn(() => of({ user: {}, ...tokens })) } as never,
      jwt,
    );
    const res = response();

    const body = await controller.login(
      { phone: '+998901234567', password: 'secret123' },
      request,
      res as never,
    );

    expect(res.cookie).toHaveBeenCalledWith(
      'accessToken',
      'access-1',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/api/v1',
      }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'refreshToken',
      refreshToken,
      expect.objectContaining({ httpOnly: true, path: '/api/v1/auth' }),
    );
    // Hozirgi frontend buzilmasligi uchun body'da ham qoladi.
    expect(body).toMatchObject({ accessToken: 'access-1' });
  });

  it('refresh cookie’dagi tokenni o‘qib, ikkala cookie’ni yangilaydi', async () => {
    const send = jest.fn(() => of(tokens));
    const controller = new AuthController({ send } as never, jwt);
    const res = response();

    await controller.refresh(
      {},
      {
        headers: { cookie: `accessToken=old; refreshToken=${refreshToken}` },
      } as never,
      res as never,
    );

    expect(send).toHaveBeenCalledWith(
      { cmd: 'auth.refresh' },
      { refreshToken },
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'accessToken',
      'access-1',
      expect.objectContaining({ path: '/api/v1' }),
    );
  });

  it('refresh rad etilsa ikkala cookie ham tozalanadi', async () => {
    const controller = new AuthController(
      {
        send: jest.fn(() =>
          throwError(() => new UnauthorizedException('Refresh yaroqsiz')),
        ),
      } as never,
      jwt,
    );
    const res = response();

    await expect(
      controller.refresh(
        {},
        { headers: { cookie: 'refreshToken=revoked' } } as never,
        res as never,
      ),
    ).rejects.toThrow();

    expect(res.clearCookie).toHaveBeenCalledWith(
      'accessToken',
      expect.objectContaining({ path: '/api/v1' }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'refreshToken',
      expect.objectContaining({ path: '/api/v1/auth' }),
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('logout ikkala cookie’ni tozalaydi', async () => {
    const controller = new AuthController(
      { send: jest.fn(() => of({ loggedOut: true })) } as never,
      jwt,
    );
    const res = response();

    await controller.logout({ sub: '42' } as never, request, res as never);

    expect(res.clearCookie).toHaveBeenCalledWith(
      'accessToken',
      expect.objectContaining({ httpOnly: true, path: '/api/v1' }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'refreshToken',
      expect.objectContaining({ httpOnly: true, path: '/api/v1/auth' }),
    );
  });
});

describe('AuthController — AUTH_TOKENS_IN_BODY=false', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  const refreshToken = jwt.sign({ sub: '42' }, { expiresIn: '7d' });
  const tokens = { accessToken: 'access-1', refreshToken };
  const config = { get: () => false };
  const request = { secure: true, headers: {} } as never;
  const response = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });

  it('login tokenni body’da qaytarmaydi, faqat cookie’ga yozadi', async () => {
    const controller = new AuthController(
      { send: jest.fn(() => of({ user: {}, ...tokens })) } as never,
      jwt,
      config as never,
    );
    const res = response();

    const body = await controller.login(
      { phone: '+998901234567', password: 'secret123' },
      request,
      res as never,
    );

    expect(body).not.toHaveProperty('accessToken');
    expect(res.cookie).toHaveBeenCalledWith(
      'accessToken',
      'access-1',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('refresh tokenni body’da qaytarmaydi', async () => {
    const controller = new AuthController(
      { send: jest.fn(() => of(tokens)) } as never,
      jwt,
      config as never,
    );

    const body = await controller.refresh(
      {},
      { headers: { cookie: `refreshToken=${refreshToken}` } } as never,
      response() as never,
    );

    expect(body).not.toHaveProperty('accessToken');
  });

  it('register faqat user’ni qaytaradi', async () => {
    const controller = new AuthController(
      { send: jest.fn(() => of({ user: { id: '42' }, ...tokens })) } as never,
      jwt,
      config as never,
    );

    const body = await controller.register(
      {} as never,
      request,
      response() as never,
    );

    expect(body).toEqual({ user: { id: '42' } });
  });
});
