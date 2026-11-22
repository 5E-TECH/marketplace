import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ActivityLog, Role, totpAt, totpStep } from '@app/common';
import { AuthSession } from '../entities/auth-session.entity';
import { User } from '../entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { IDENTITY_DB } from '../database';
import { TwoFactorChallenge, TwoFactorGate } from './two-factor.gate';
import { TwoFactorService } from './two-factor.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
/** team/new-roles.integration.spec.ts dagi bilan bir xil: identity sxemasini DROP/CREATE qiladigan spec’lar ketma-ket. */
const IDENTITY_SCHEMA_TEST_LOCK = 2_304_003;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    return (error as HttpException).getStatus();
  }
  throw new Error('xato kutilgan edi');
}

/** BE-26 (T8, TC4): admin va moliya 2FA (TOTP) — haqiqiy PostgreSQL. */
describeWithPostgres('BE-26 xodim 2FA (PostgreSQL)', () => {
  let ds: DataSource;
  let schemaLock: Client | undefined;
  let auth: AuthService;
  let twoFactor: TwoFactorService;
  const env: Record<string, string> = {
    JWT_SECRET: 'be26-test-secret',
    JWT_REFRESH_SECRET: 'be26-test-refresh',
    TWO_FACTOR_SECRET_KEY: 'be26-totp-key-0123456789',
    ADMIN_2FA: 'on',
  };
  const config = {
    get: (k: string, fallback?: unknown) => env[k] ?? fallback,
    getOrThrow: (k: string) => env[k],
  } as unknown as ConfigService;

  beforeAll(async () => {
    if (!new URL(testDatabaseUrl!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    schemaLock = new Client({ connectionString: testDatabaseUrl });
    await schemaLock.connect();
    await schemaLock.query('SELECT pg_advisory_lock($1)', [
      IDENTITY_SCHEMA_TEST_LOCK,
    ]);
    const admin = new Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query('DROP SCHEMA IF EXISTS identity CASCADE');
    await admin.query('CREATE SCHEMA identity');
    await admin.end();
    ds = await new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      schema: 'identity',
      entities: [User, AuthSession, ActivityLog],
      migrations: IDENTITY_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    const jwt = new JwtService({ secret: env.JWT_SECRET });
    const gate = new TwoFactorGate(jwt, config);
    auth = new AuthService(
      ds.getRepository(User),
      ds.getRepository(AuthSession),
      jwt,
      config,
      ds,
      { emit: () => ({ subscribe: () => undefined }) } as never,
      gate,
    );
    twoFactor = new TwoFactorService(ds, gate, auth, config);
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS identity CASCADE');
      await ds.destroy();
    }
    if (schemaLock) {
      await schemaLock.query('SELECT pg_advisory_unlock($1)', [
        IDENTITY_SCHEMA_TEST_LOCK,
      ]);
      await schemaLock.end();
    }
  });

  const staff = async (phone: string, role: Role) => {
    await auth.register({
      name: 'Xodim',
      phone,
      password: 'Secret123',
    } as never);
    await ds.query(`UPDATE identity.users SET role = $2 WHERE phone = $1`, [
      phone,
      role,
    ]);
  };
  const login = (phone: string) =>
    auth.login({ phone, password: 'Secret123' } as never);

  it('TC4: admin 2FA kodisiz kira olmaydi — avval ulash, keyin har kirishda kod; tiklash kodi bir marta', async () => {
    const phone = '+998900002601';
    await staff(phone, Role.ADMIN);

    const first = (await login(phone)) as TwoFactorChallenge;
    expect(first).toMatchObject({
      twoFactorRequired: false,
      twoFactorSetupRequired: true,
    });
    expect(first).not.toHaveProperty('accessToken');
    // challenge tokeni kirish tokeni emas
    expect(() =>
      new JwtService({ secret: env.JWT_SECRET }).verify(first.challengeToken),
    ).toThrow();

    const { secret, otpauthUrl } = await twoFactor.setup(first.challengeToken);
    expect(otpauthUrl).toContain(`secret=${secret}`);
    // kodsiz yoki noto‘g‘ri kod — sessiya yo‘q
    expect(
      await statusOf(twoFactor.enable(first.challengeToken, '000000')),
    ).toBe(401);
    const s0 = totpStep();
    const enabled = await twoFactor.enable(
      first.challengeToken,
      totpAt(secret, s0),
    );
    expect(enabled.recoveryCodes).toHaveLength(8);
    expect(enabled.accessToken).toEqual(expect.any(String));

    const second = (await login(phone)) as TwoFactorChallenge;
    expect(second).toMatchObject({
      twoFactorRequired: true,
      twoFactorSetupRequired: false,
    });
    // shu oraliqdagi kod qayta ishlatilmaydi
    expect(
      await statusOf(
        twoFactor.verify(second.challengeToken, totpAt(secret, s0)),
      ),
    ).toBe(401);
    await expect(
      twoFactor.verify(
        second.challengeToken,
        undefined,
        enabled.recoveryCodes[0],
      ),
    ).resolves.toHaveProperty('accessToken');
    expect(
      await statusOf(
        twoFactor.verify(
          second.challengeToken,
          undefined,
          enabled.recoveryCodes[0],
        ),
      ),
    ).toBe(401); // bir martalik
  });

  it('3 xato kod → 423 blok (to‘g‘ri kod ham o‘tmaydi)', async () => {
    const phone = '+998900002602';
    await staff(phone, Role.FINANCE);
    const c1 = (await login(phone)) as TwoFactorChallenge;
    const { secret } = await twoFactor.setup(c1.challengeToken);
    await twoFactor.enable(c1.challengeToken, totpAt(secret, totpStep() - 1));
    const c2 = (await login(phone)) as TwoFactorChallenge;
    for (let i = 0; i < 3; i++)
      expect(
        await statusOf(twoFactor.verify(c2.challengeToken, '000000')),
      ).toBe(401);
    expect(
      await statusOf(
        twoFactor.verify(c2.challengeToken, totpAt(secret, totpStep())),
      ),
    ).toBe(423);
  });

  it('sotuvchi va operator — 2FA siz; bayroq o‘chiq — admin ham bugungidek', async () => {
    await staff('+998900002603', Role.OPERATOR_LEAD);
    await expect(login('+998900002603')).resolves.toHaveProperty('accessToken');
    env.ADMIN_2FA = 'off';
    try {
      await staff('+998900002604', Role.SUPERADMIN);
      await expect(login('+998900002604')).resolves.toHaveProperty(
        'accessToken',
      );
    } finally {
      env.ADMIN_2FA = 'on';
    }
  });

  it('superadmin 2FA ni nolga tushiradi: sessiyalar yopiladi, eski challenge yaroqsiz, qayta ulash kerak', async () => {
    const phone = '+998900002605';
    await staff(phone, Role.ADMIN);
    const c1 = (await login(phone)) as TwoFactorChallenge;
    const { secret } = await twoFactor.setup(c1.challengeToken);
    await twoFactor.enable(c1.challengeToken, totpAt(secret, totpStep()));
    const pending = (await login(phone)) as TwoFactorChallenge;
    const [{ id }] = (await ds.query(
      `SELECT id::text FROM identity.users WHERE phone = $1`,
      [phone],
    )) as Array<{ id: string }>;
    const [{ id: superId }] = (await ds.query(
      `SELECT id::text FROM identity.users WHERE role = 'SUPERADMIN' LIMIT 1`,
    )) as Array<{ id: string }>;
    expect(await statusOf(twoFactor.reset(id, id))).toBe(403); // admin o‘zi emas
    await expect(twoFactor.reset(superId, id)).resolves.toEqual({
      reset: true,
    });
    expect(
      await statusOf(
        twoFactor.verify(
          pending.challengeToken,
          totpAt(secret, totpStep() + 1),
        ),
      ),
    ).toBe(401);
    await expect(login(phone)).resolves.toMatchObject({
      twoFactorSetupRequired: true,
    });
    const [{ open }] = (await ds.query(
      `SELECT count(*)::int AS open FROM identity.auth_session WHERE user_id = $1 AND revoked_at IS NULL`,
      [id],
    )) as Array<{ open: number }>;
    expect(open).toBe(0);
  });

  it('refresh: 2FA siz ochilgan xodim sessiyasi (bayroqdan oldin) yangilanmaydi; 2FA dan keyingisi yangilanadi', async () => {
    const phone = '+998900002606';
    await staff(phone, Role.ADMIN);
    env.ADMIN_2FA = 'off';
    const old = (await login(phone)) as { refreshToken: string };
    env.ADMIN_2FA = 'on';
    expect(await statusOf(auth.refresh(old.refreshToken))).toBe(401);

    const c = (await login(phone)) as TwoFactorChallenge;
    const { secret } = await twoFactor.setup(c.challengeToken);
    const session = await twoFactor.enable(
      c.challengeToken,
      totpAt(secret, totpStep()),
    );
    const renewed = await auth.refresh(session.refreshToken);
    expect(renewed).toHaveProperty('accessToken');
    // belgi yangilangan refresh tokenda ham qoladi
    await expect(auth.refresh(renewed.refreshToken)).resolves.toHaveProperty(
      'accessToken',
    );
  });

  it('parallel xato urinishlar 3 dan oshmaydi (keyingilari — 423)', async () => {
    const phone = '+998900002607';
    await staff(phone, Role.SUPERADMIN);
    const c1 = (await login(phone)) as TwoFactorChallenge;
    const { secret } = await twoFactor.setup(c1.challengeToken);
    await twoFactor.enable(c1.challengeToken, totpAt(secret, totpStep() - 1));
    const c2 = (await login(phone)) as TwoFactorChallenge;
    const codes = ['000001', '000002', '000003', '000004', '000005', '000006'];
    const statuses = await Promise.all(
      codes.map((code) => statusOf(twoFactor.verify(c2.challengeToken, code))),
    );
    expect(statuses.filter((st) => st === 401).length).toBeLessThanOrEqual(3);
    expect(statuses.filter((st) => st === 423).length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('3-urinishdan keyin blok; muddati o‘tgach hisob boshidan, to‘g‘ri kod blok va hisobni nolga tushiradi', async () => {
    const phone = '+998900002608';
    await staff(phone, Role.SUPERADMIN);
    const c1 = (await login(phone)) as TwoFactorChallenge;
    const { secret } = await twoFactor.setup(c1.challengeToken);
    await twoFactor.enable(c1.challengeToken, totpAt(secret, totpStep() - 1));
    const c2 = (await login(phone)) as TwoFactorChallenge;
    for (const code of ['000001', '000002', '000003'])
      expect(await statusOf(twoFactor.verify(c2.challengeToken, code))).toBe(
        401,
      );
    expect(await statusOf(twoFactor.verify(c2.challengeToken, '000004'))).toBe(
      423,
    );
    // blok muddati o‘tdi
    await ds.query(
      `UPDATE identity.users SET totp_blocked_until = now() - interval '1 second' WHERE phone = $1`,
      [phone],
    );
    expect(await statusOf(twoFactor.verify(c2.challengeToken, '000005'))).toBe(
      401,
    );
    await expect(
      twoFactor.verify(c2.challengeToken, totpAt(secret, totpStep())),
    ).resolves.toHaveProperty('accessToken');
    const [row] = (await ds.query(
      `SELECT totp_failed_count AS count, totp_blocked_until AS until FROM identity.users WHERE phone = $1`,
      [phone],
    )) as Array<{ count: number; until: Date | null }>;
    expect(row).toEqual({ count: 0, until: null });
  });
});
