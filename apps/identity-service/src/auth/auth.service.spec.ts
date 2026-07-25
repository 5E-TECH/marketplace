import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Role } from '@app/common';
import { AuthService } from './auth.service';

// C0.4: register hash, login JWT(sub,role), noto'g'ri parol 401, dublikat phone 409, soxta token 401
describe('AuthService (C0.4)', () => {
  let service: AuthService;
  let saveSpy: jest.Mock;
  let sessionStore: any[];
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
    sessionStore = [];
    const sessions = {
      findOne: jest.fn(
        async ({ where }: any) =>
          sessionStore.find(
            (session) =>
              session.id === where.id && session.userId === where.userId,
          ) ?? null,
      ),
      create: (value: any) => ({ ...value }),
      save: jest.fn(async (session: any) => {
        const index = sessionStore.findIndex(
          (stored) => stored.id === session.id,
        );
        if (index === -1) sessionStore.push(session);
        else sessionStore[index] = session;
        return session;
      }),
      update: jest.fn(async (criteria: any, values: any) => {
        let affected = 0;
        for (const session of sessionStore) {
          if (
            session.userId === criteria.userId &&
            session.revokedAt === null
          ) {
            Object.assign(session, values);
            affected += 1;
          }
        }
        return { affected };
      }),
    };
    service = new AuthService(users as any, sessions as any, jwt, config);
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

  it('logout userning barcha refresh sessiyalarini bekor qiladi', async () => {
    const auth = await service.register({
      name: 'A',
      phone: '+998901112233',
      password: 'Secret123',
    });
    await service.login({
      phone: '+998901112233',
      password: 'Secret123',
    });

    await expect(service.logout(auth.user.id)).resolves.toBeNull();
    expect(sessionStore).toHaveLength(2);
    expect(
      sessionStore.every((session) => session.revokedAt instanceof Date),
    ).toBe(true);
  });

  it('logout takror chaqirilsa ham idempotent', async () => {
    const auth = await service.register({
      name: 'A',
      phone: '+998901112233',
      password: 'Secret123',
    });
    await service.logout(auth.user.id);

    await expect(service.logout(auth.user.id)).resolves.toBeNull();
  });

  it('logout boshqa user sessiyasini bekor qilmaydi', async () => {
    const first = await service.register({
      name: 'A',
      phone: '+998901112233',
      password: 'Secret123',
    });
    const second = await service.register({
      name: 'B',
      phone: '+998901112234',
      password: 'Secret123',
    });

    await service.logout(first.user.id);

    expect(
      sessionStore.find((session) => session.userId === first.user.id)
        .revokedAt,
    ).toBeInstanceOf(Date);
    expect(
      sessionStore.find((session) => session.userId === second.user.id)
        .revokedAt,
    ).toBeNull();
  });
});
