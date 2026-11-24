import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { of } from 'rxjs';
import { Role } from '@app/common';
import { AuthResult, AuthService } from './auth.service';

// C0.4: register hash, login JWT(sub,role), noto'g'ri parol 401, dublikat phone 409, soxta token 401
describe('AuthService (C0.4)', () => {
  let service: AuthService;
  let saveSpy: jest.Mock;
  let sessionStore: any[];
  let managerQuery: jest.Mock;
  let transaction: jest.Mock;
  let notificationEmit: jest.Mock;
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
    managerQuery = jest.fn();
    transaction = jest.fn(async (callback: (manager: any) => unknown) =>
      callback({ query: managerQuery }),
    );
    notificationEmit = jest.fn(() => of(undefined));
    service = new AuthService(
      users as any,
      sessions as any,
      jwt,
      config,
      { transaction } as any,
      { emit: notificationEmit } as any,
    );
  });

  it('BE-25: ismlar ID bo‘yicha — takroriy va noto‘g‘ri ID tashlanadi, telefon chiqmaydi', async () => {
    const find = jest.fn(async () => [
      { id: '3', name: ' Nodira K. ', role: Role.ADMIN },
      { id: '5', name: null, role: Role.WAREHOUSE },
    ]);
    (service as any).users.find = find;
    await expect(
      service.userNames(['3', '3', '5', 'x', '0', '99999999999999999999']),
    ).resolves.toEqual([
      { id: '3', name: 'Nodira K.', role: Role.ADMIN },
      { id: '5', name: null, role: Role.WAREHOUSE },
    ]);
    const [options] = find.mock.calls[0] as unknown as [
      { where: { id: { value: string[] } }; select: Record<string, boolean> },
    ];
    expect(options.where.id.value).toEqual(['3', '5']);
    expect(options.select).toEqual({ id: true, name: true, role: true });
    await expect(service.userNames([])).resolves.toEqual([]);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('TC1: register parolni hash qiladi (plain saqlamaydi)', async () => {
    const res = await service.register({
      name: 'Akmal',
      phone: '+998901112233',
      password: 'Secret123',
      role: Role.AFFILIATE,
    });
    const saved = saveSpy.mock.calls[0][0];
    expect(saved.passwordHash).toBeDefined();
    expect(saved.passwordHash).not.toBe('Secret123');
    expect(await bcrypt.compare('Secret123', saved.passwordHash)).toBe(true);
    expect((res.user as any).passwordHash).toBeUndefined(); // sanitize
    expect(saved).toMatchObject({ role: Role.AFFILIATE, isActive: true });
  });

  it('BE-05 TC5: rol berilmasa sotuvchi (AFFILIATE) yaratiladi, BUYER emas', async () => {
    await service.register({
      name: 'Akmal',
      phone: '+998901112233',
      password: 'Secret123',
    });
    expect(saveSpy.mock.calls[0][0].role).toBe(Role.AFFILIATE);
  });

  it.each(['BUYER', 'SELLER', Role.WHOLESALER, Role.OPERATOR_LEAD, Role.ADMIN])(
    'BE-05 TC4/TC5: ochiq ro‘yxat %s rolini rad etadi (400), foydalanuvchi yaratilmaydi',
    async (role) => {
      await expect(
        service.register({
          name: 'Akmal',
          phone: '+998901112233',
          password: 'Secret123',
          role,
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(saveSpy).not.toHaveBeenCalled();
    },
  );

  it('BE-05: eski checkout mehmon xaridorni foydalanuvchi qilib yaratmaydi', () => {
    expect(() => service.createGuestCustomer()).toThrow(
      'Mijoz tizim foydalanuvchisi emas',
    );
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('admin profil parolini eski parolsiz yangilaydi va sessiyalarni bekor qiladi', async () => {
    const registered = await service.register({
      name: 'Admin',
      phone: '+998901112233',
      password: 'OldSecret123',
      role: Role.AFFILIATE,
    });
    expect(sessionStore[0].revokedAt).toBeNull();

    const updated = await service.updateProfile(registered.user.id, {
      password: 'NewSecret123',
    });

    expect((updated as any).passwordHash).toBeUndefined();
    expect(sessionStore[0].revokedAt).toBeInstanceOf(Date);
    await expect(
      service.login({
        phone: '+998901112233',
        password: 'NewSecret123',
      }),
    ).resolves.toBeDefined();
    await expect(
      service.login({
        phone: '+998901112233',
        password: 'OldSecret123',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
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

  it('C6.1: public register orqali ADMIN/SUPERADMIN yaratishni rad etadi', async () => {
    await expect(
      service.register({
        name: 'Soxta admin',
        phone: '+998901119999',
        password: 'Secret123',
        role: Role.SUPERADMIN,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('TC2: login JWT beradi (sub, role)', async () => {
    await service.register({
      name: 'A',
      phone: '+998901112233',
      password: 'Secret123',
      role: Role.AFFILIATE,
    });
    const res = (await service.login({
      phone: '+998901112233',
      password: 'Secret123',
    })) as AuthResult;
    const payload: any = jwt.verify(res.accessToken);
    expect(payload.sub).toBeDefined();
    expect(payload.role).toBe(Role.AFFILIATE);
    // BE-05 TC3: tokenda do‘kon yo‘q (access va refresh)
    expect(payload).not.toHaveProperty('shopId');
    expect(jwt.decode(res.refreshToken)).not.toHaveProperty('shopId');
    expect(res.refreshToken).toBeDefined();
  });

  it('C1.29 TC2/TC3: block -> login 401; unblock -> login ishlaydi', async () => {
    const reg: any = await service.register({
      name: 'A',
      phone: '+998901110000',
      password: 'Secret123',
      role: Role.AFFILIATE,
    });
    const userId = reg.user.id;

    // TC2: bloklangan -> login 401
    await service.setBlocked('999', userId, true);
    await expect(
      service.login({ phone: '+998901110000', password: 'Secret123' }),
    ).rejects.toThrow('bloklangan');

    // TC3: unblock -> login qaytadan ishlaydi
    await service.setBlocked('999', userId, false);
    const res: any = await service.login({
      phone: '+998901110000',
      password: 'Secret123',
    });
    expect(res.accessToken).toBeDefined();
  });

  it('C1.29 TC4: admin o‘zini bloklay olmaydi -> 409', async () => {
    const reg: any = await service.register({
      name: 'Admin',
      phone: '+998901110001',
      password: 'Secret123',
      role: Role.AFFILIATE,
    });
    const adminId = reg.user.id;
    try {
      await service.setBlocked(adminId, adminId, true);
      throw new Error("kutilgan xato bo'lmadi");
    } catch (e: any) {
      expect(e.getStatus()).toBe(409);
    }
  });

  it('BE-05: admin superadmin yoki boshqa admin hisobini bloklay olmaydi; superadmin — oladi', async () => {
    const admin: any = (
      await service.register({
        name: 'Admin',
        phone: '+998901110010',
        password: 'Secret123',
      })
    ).user;
    const owner: any = (
      await service.register({
        name: 'Rahbar',
        phone: '+998901110011',
        password: 'Secret123',
      })
    ).user;
    const stored = (id: string) =>
      saveSpy.mock.calls.map((call) => call[0]).find((u) => u.id === id);
    stored(admin.id).role = Role.ADMIN;
    stored(owner.id).role = Role.SUPERADMIN;

    await expect(
      service.setBlocked(admin.id, owner.id, true),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(stored(owner.id).isBlocked).toBeFalsy();
    await expect(
      service.setBlocked(owner.id, admin.id, true),
    ).resolves.toMatchObject({ isBlocked: true });
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

// C1.28 — countUsersByRole: faqat `this.users` ishlatadi, shu bois prototip
// orqali (og'ir konstruktorsiz) sinaladi.
describe('AuthService.countUsersByRole (C1.28)', () => {
  function makeQb(rows: Array<{ role: string; count: string }>) {
    return {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(() => Promise.resolve(rows)),
    } as any;
  }

  it('rol bo‘yicha sanaydi (yo‘q rol = 0)', async () => {
    const qb = makeQb([
      { role: 'AFFILIATE', count: '12' },
      { role: 'OPERATOR_LEAD', count: '25' },
      { role: 'ADMIN', count: '2' },
    ]);
    const svc: any = Object.create(AuthService.prototype);
    svc.users = { createQueryBuilder: jest.fn(() => qb) };

    await expect(svc.countUsersByRole()).resolves.toEqual({
      total: 39,
      AFFILIATE: 12,
      WHOLESALER: 0,
      OPERATOR_LEAD: 25,
      SUPERVISOR: 0,
      WAREHOUSE: 0,
      FINANCE: 0,
      ADMIN: 2,
      SUPERADMIN: 0,
    });
    expect(qb.groupBy).toHaveBeenCalledWith('u.role');
  });

  it('yangi platforma -> hammasi 0', async () => {
    const qb = makeQb([]);
    const svc: any = Object.create(AuthService.prototype);
    svc.users = { createQueryBuilder: jest.fn(() => qb) };

    await expect(svc.countUsersByRole()).resolves.toEqual({
      total: 0,
      AFFILIATE: 0,
      WHOLESALER: 0,
      OPERATOR_LEAD: 0,
      SUPERVISOR: 0,
      WAREHOUSE: 0,
      FINANCE: 0,
      ADMIN: 0,
      SUPERADMIN: 0,
    });
  });
});

// C1.29 — adminListUsers: createQueryBuilder ishlatadi, prototip orqali sinaladi.
describe('AuthService.adminListUsers (C1.29)', () => {
  it('TC1: role filtri qo‘llaydi + parol hash chiqmaydi (sanitize)', async () => {
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(() =>
        Promise.resolve([
          [{ id: '1', role: 'AFFILIATE', name: 'Ali', passwordHash: 'h' }],
          1,
        ]),
      ),
    };
    const svc: any = Object.create(AuthService.prototype);
    svc.users = { createQueryBuilder: jest.fn(() => qb) };

    const res = await svc.adminListUsers({
      role: 'AFFILIATE',
      page: 1,
      limit: 20,
    });

    expect(qb.andWhere).toHaveBeenCalledWith('u.role != :hiddenRole', {
      hiddenRole: Role.SUPERADMIN,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('u.role = :role', {
      role: 'AFFILIATE',
    });
    expect(res).toMatchObject({ total: 1, page: 1, limit: 20, totalPages: 1 });
    expect((res.items[0] as any).passwordHash).toBeUndefined();
  });

  it('SUPERADMIN umumiy ro‘yxatdan doim yashiriladi', async () => {
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(() => Promise.resolve([[], 0])),
    };
    const svc: any = Object.create(AuthService.prototype);
    svc.users = { createQueryBuilder: jest.fn(() => qb) };

    await svc.adminListUsers({ role: Role.SUPERADMIN });

    expect(qb.andWhere).toHaveBeenNthCalledWith(1, 'u.role != :hiddenRole', {
      hiddenRole: Role.SUPERADMIN,
    });
    expect(qb.andWhere).toHaveBeenNthCalledWith(2, 'u.role = :role', {
      role: Role.SUPERADMIN,
    });
  });

  it('blocked filtri qo‘llaydi', async () => {
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(() => Promise.resolve([[], 0])),
    };
    const svc: any = Object.create(AuthService.prototype);
    svc.users = { createQueryBuilder: jest.fn(() => qb) };

    await svc.adminListUsers({ blocked: true });

    expect(qb.andWhere).toHaveBeenCalledWith('u.is_blocked = :blocked', {
      blocked: true,
    });
  });
});
