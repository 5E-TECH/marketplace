import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { of } from 'rxjs';
import { Role, STAFF_ROLES } from '@app/common';
import { IDENTITY_DB } from '../database';
import { User } from '../entities/user.entity';
import { AuthSession } from '../entities/auth-session.entity';
import { AuthResult, AuthService } from '../auth/auth.service';
import { AdminUserAccessService } from '../admin-user-access/admin-user-access.service';
import { AdminTeamService } from './admin-team.service';
import { NewRoles1795996800000 } from '../migrations/1795996800000-new-roles';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
/** identity sxemasini DROP/CREATE qiladigan spec’lar bir qulf bilan ketma-ket (broadcast-recipients bilan bir xil). */
const IDENTITY_SCHEMA_TEST_LOCK = 2_304_003;

/**
 * BE-05 haqiqiy PostgreSQL da (hamma identity migratsiyasi): xodim rollari jamoa bo‘limida yaratiladi va login
 * bo‘ladi (TC1), tokenda do‘kon yo‘q (TC3), eski rol yaratilmaydi (TC4), ochiq ro‘yxat faqat sotuvchi (TC5),
 * bloklangan foydalanuvchi tokeni shu zahoti bekor (authVersion).
 */
describeWithPostgres('BE-05 yangi rollar (PostgreSQL)', () => {
  let schemaLock: Client | undefined;
  let ds: DataSource;
  let auth: AuthService;
  let team: AdminTeamService;
  let access: AdminUserAccessService;
  let superadminId: string;
  let oldRowsError: Error | null = null;
  let shopIdAfterAbort = 0;
  const jwt = new JwtService({ secret: 'be05-integration' });
  const config = {
    get: (key: string, fallback?: unknown) =>
      ({ JWT_REFRESH_SECRET: 'be05-refresh' })[key] ?? fallback,
  };

  beforeAll(async () => {
    if (!new URL(url!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    schemaLock = new Client({ connectionString: url });
    await schemaLock.connect();
    await schemaLock.query('SELECT pg_advisory_lock($1)', [
      IDENTITY_SCHEMA_TEST_LOCK,
    ]);
    await schemaLock.query('DROP SCHEMA IF EXISTS identity CASCADE');
    await schemaLock.query('CREATE SCHEMA identity');

    // Eski bazaga o‘xshash: BE-05 dan oldingi migratsiyalar va eski BUYER qatori → yangi migratsiya to‘xtashi kerak
    const old = await new DataSource({
      type: 'postgres',
      url,
      schema: 'identity',
      entities: IDENTITY_DB.entities as never,
      migrations: IDENTITY_DB.migrations.filter(
        (m) => m !== NewRoles1795996800000,
      ),
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    await old.query(
      `INSERT INTO identity.users (role, name, phone, password_hash) VALUES ('BUYER', 'Eski', '+998900000900', 'h')`,
    );
    const runner = old.createQueryRunner();
    oldRowsError = await new NewRoles1795996800000()
      .up(runner)
      .then(() => null)
      .catch((error: Error) => error);
    await runner.release();
    shopIdAfterAbort = (
      (await old.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'identity' AND table_name = 'users' AND column_name = 'shop_id'`,
      )) as unknown[]
    ).length;
    await old.query(`DELETE FROM identity.users`);
    await old.destroy();

    ds = await new DataSource({
      type: 'postgres',
      url,
      schema: 'identity',
      entities: IDENTITY_DB.entities as never,
      migrations: IDENTITY_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    auth = new AuthService(
      ds.getRepository(User),
      ds.getRepository(AuthSession),
      jwt,
      config as never,
      ds,
      { emit: () => of(undefined) } as never,
    );
    team = new AdminTeamService(ds);
    access = new AdminUserAccessService(ds, jwt);
    const owner = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        name: 'Rahbar',
        phone: '+998900000001',
        passwordHash: 'x',
        role: Role.SUPERADMIN,
        isActive: true,
      }),
    );
    superadminId = String(owner.id);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS identity CASCADE');
      await ds.destroy();
    }
    await schemaLock?.end(); // sessiya yopilsa qulf bo‘shaydi
  });

  it('migratsiya eski BUYER qatori bor bazada hech narsani o‘zgartirmay to‘xtaydi (BE-40 — toza baza)', () => {
    expect(oldRowsError?.message).toMatch(
      /eski rollar bor \(BUYER: 1\).*BE-40/,
    );
    expect(shopIdAfterAbort).toBe(1);
  });

  it('TC1/TC3: superadmin har bir xodim rolini yaratadi, xodim login bo‘ladi; tokenda rol bor, shopId yo‘q', async () => {
    let n = 10;
    for (const role of STAFF_ROLES) {
      const phone = `+9989000000${n++}`;
      const member = await team.create(superadminId, {
        name: `Xodim ${role}`,
        phone,
        role,
        password: 'Secret123',
      });
      expect(member.role).toBe(role);
      const { accessToken, refreshToken, user } = (await auth.login({
        phone,
        password: 'Secret123',
      })) as AuthResult;
      expect(user.role).toBe(role);
      const payload = jwt.decode(accessToken) as Record<string, unknown>;
      expect(payload).toMatchObject({ sub: String(member.id), role });
      expect(payload).not.toHaveProperty('shopId');
      expect(jwt.decode(refreshToken)).not.toHaveProperty('shopId');
    }
  });

  it('TC5: ochiq ro‘yxat sotuvchi (AFFILIATE) yaratadi; BUYER bilan — 400, foydalanuvchi yaratilmaydi', async () => {
    const result = await auth.register({
      name: 'Sotuvchi',
      phone: '+998900000101',
      password: 'Secret123',
    });
    expect(result.user.role).toBe(Role.AFFILIATE);
    await expect(
      auth.register({
        name: 'Mijoz',
        phone: '+998900000102',
        password: 'Secret123',
        role: 'BUYER',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await ds.getRepository(User).count({ where: { phone: '+998900000102' } }),
    ).toBe(0);
  });

  it('TC4: SELLER rolini yaratib bo‘lmaydi — jamoa va rol almashtirish 400, baza CHECK i ham rad etadi', async () => {
    await expect(
      team.create(superadminId, {
        name: 'Eski',
        phone: '+998900000201',
        role: 'SELLER' as never,
        password: 'Secret123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const affiliate = await ds
      .getRepository(User)
      .findOneByOrFail({ phone: '+998900000101' });
    await expect(
      access.updateRole(superadminId, String(affiliate.id), {
        role: 'SELLER' as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ds.query(`UPDATE identity.users SET role = 'SELLER' WHERE id = $1`, [
        affiliate.id,
      ]),
    ).rejects.toThrow(/chk_identity_users_role/);
  });

  it('bloklangan foydalanuvchi: eski token shu zahoti rad (authVersion), login ham 401', async () => {
    const login = (await auth.login({
      phone: '+998900000101',
      password: 'Secret123',
    })) as AuthResult;
    const payload = jwt.decode(login.accessToken) as {
      sub: string;
      role: Role;
      authVersion: number;
    };
    await expect(
      access.authorizeToken(payload.sub, payload.role, payload.authVersion),
    ).resolves.toEqual({ authorized: true });

    await auth.setBlocked(superadminId, payload.sub, true);

    await expect(
      access.authorizeToken(payload.sub, payload.role, payload.authVersion),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      auth.login({ phone: '+998900000101', password: 'Secret123' }),
    ).rejects.toMatchObject({ status: 401 });
  });
});
