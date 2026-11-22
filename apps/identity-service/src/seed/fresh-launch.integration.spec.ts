import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ActivityLog, Role } from '@app/common';
import { AuthSession } from '../entities/auth-session.entity';
import { User } from '../entities/user.entity';
import { AuthResult, AuthService } from '../auth/auth.service';
import { IDENTITY_DB } from '../database';
import { AdminSeeder } from './admin.seeder';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
/** team/new-roles.integration.spec.ts dagi bilan bir xil: identity sxemasini DROP/CREATE qiladigan spec’lar ketma-ket. */
const IDENTITY_SCHEMA_TEST_LOCK = 2_304_003;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/** BE-40 TC1: toza bazada identity — migratsiyalar, SUPERADMIN seed (SEED_ADMIN_*), kirish. */
describeWithPostgres('BE-40: toza bazada ishga tushish (PostgreSQL)', () => {
  let ds: DataSource;
  let schemaLock: Client | undefined;
  const env: Record<string, string> = {
    JWT_SECRET: 'be40-test-secret-0123456789',
    JWT_REFRESH_SECRET: 'be40-test-refresh-0123456789',
    SEED_ADMIN_PHONE: '+998900004001',
    SEED_ADMIN_PASSWORD: 'Boshlang1ch!Parol',
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

  it('TC1: bo‘sh baza → migratsiyalar → SUPERADMIN seed → kirish; qayta ishga tushish ikkinchi admin yaratmaydi', async () => {
    expect(await ds.getRepository(User).count()).toBe(0); // eski foydalanuvchi yo‘q
    const seeder = new AdminSeeder(ds.getRepository(User), config);
    await seeder.onApplicationBootstrap();
    await seeder.onApplicationBootstrap(); // servis qayta ishga tushdi
    const users = await ds.getRepository(User).find();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      phone: env.SEED_ADMIN_PHONE,
      role: Role.SUPERADMIN,
      isActive: true,
    });

    const auth = new AuthService(
      ds.getRepository(User),
      ds.getRepository(AuthSession),
      new JwtService({ secret: env.JWT_SECRET }),
      config,
      ds,
      { emit: () => ({ subscribe: () => undefined }) } as never,
    );
    const result = (await auth.login({
      phone: env.SEED_ADMIN_PHONE,
      password: env.SEED_ADMIN_PASSWORD,
    } as never)) as AuthResult;
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it('TC2: migratsiyalar qayta yurgizilsa hech narsa o‘zgarmaydi', async () => {
    await expect(ds.runMigrations()).resolves.toEqual([]);
  });
});
