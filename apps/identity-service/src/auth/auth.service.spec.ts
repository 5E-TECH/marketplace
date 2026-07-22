import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Role } from '@app/common';
import { AuthService } from './auth.service';

// C0.4: register hash, login JWT(sub,role), noto'g'ri parol 401, dublikat phone 409, soxta token 401
describe('AuthService (C0.4)', () => {
  let service: AuthService;
  let saveSpy: jest.Mock;
  const jwt = new JwtService({ secret: 'test-access-secret' });
  const config = {
    get: (key: string, def?: unknown) =>
      (
        ({
          JWT_EXPIRES_IN: '1h',
          JWT_REFRESH_SECRET: 'test-refresh-secret',
          JWT_REFRESH_EXPIRES_IN: '7d',
        }) as Record<string, unknown>
      )[key] ?? def,
  } as any;

  beforeEach(() => {
    const store: any[] = [];
    saveSpy = jest.fn(async (u: any) => {
      if (!store.includes(u)) store.push(u);
      return u;
    });
    const users = {
      findOne: jest.fn(
        async ({ where }: any) =>
          store.find(
            (u) =>
              (where.phone && u.phone === where.phone) ||
              (where.id && u.id === where.id),
          ) ?? null,
      ),
      create: (o: any) => ({
        id: String(store.length + 1),
        isDeleted: false,
        ...o,
      }),
      save: saveSpy,
    };
    service = new AuthService(users as any, jwt, config);
  });

  it('TC1: register parolni hash qiladi (plain saqlamaydi)', async () => {
    const res = await service.register({
      name: 'Akmal',
      phone: '+998901112233',
      password: 'Secret123',
      role: Role.SELLER,
    });
    const saved = saveSpy.mock.calls[0][0];
    expect(saved.passwordHash).toBeDefined();
    expect(saved.passwordHash).not.toBe('Secret123');
    expect(await bcrypt.compare('Secret123', saved.passwordHash)).toBe(true);
    expect((res.user as any).passwordHash).toBeUndefined(); // sanitize
    expect(saved.isActive).toBe(false); // SELLER — tasdiqqacha nofaol
  });

  it('TC4: dublikat telefon -> 409', async () => {
    await service.register({
      name: 'A',
      phone: '+998901112233',
      password: 'Secret123',
    });
    try {
      await service.register({
        name: 'B',
        phone: '+998901112233',
        password: 'Other123',
      });
      throw new Error("kutilgan xato bo'lmadi");
    } catch (e: any) {
      expect(e.getStatus()).toBe(409);
    }
  });

  it('TC2: login JWT beradi (sub, role)', async () => {
    await service.register({
      name: 'A',
      phone: '+998901112233',
      password: 'Secret123',
      role: Role.BUYER,
    });
    const res = await service.login({
      phone: '+998901112233',
      password: 'Secret123',
    });
    const payload: any = jwt.verify(res.accessToken);
    expect(payload.sub).toBeDefined();
    expect(payload.role).toBe(Role.BUYER);
    expect(res.refreshToken).toBeDefined();
  });

  it("TC3: noto'g'ri parol -> 401", async () => {
    await service.register({
      name: 'A',
      phone: '+998901112233',
      password: 'Secret123',
    });
    await expect(
      service.login({ phone: '+998901112233', password: 'WRONG' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("TC3b: mavjud bo'lmagan telefon -> 401 (bir xil xabar)", async () => {
    await expect(
      service.login({ phone: '+998900000000', password: 'x' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('TC5: soxta/buzilgan token verify -> xato', () => {
    expect(() => jwt.verify('soxta.token.qiymat')).toThrow();
  });
});
