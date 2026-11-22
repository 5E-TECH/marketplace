import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { LEAD_DB } from '../../../../apps/lead-service/src/database';
import { runMigrationCli } from './migrate-cli';
import {
  dbCredentials,
  ensureSchema,
  perServiceRolesEnabled,
  shouldRunMigrations,
  typeOrmOptions,
} from './typeorm.util';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
const BOOTSTRAP = join(__dirname, '../../../../docs/schema/00-bootstrap.sql');

/**
 * BE-36 TC2 (T9-16): `docs/schema/00-bootstrap.sql` ning o‘zi vaqtinchalik bazada (rollar nomi testga xos prefiks bilan) —
 * har servis roli faqat o‘z sxemasida DML qiladi, boshqa servis sxemasiga yozolmaydi va o‘qiyolmaydi, DDL yo‘q.
 * Migratsiyani haqiqiy CLI migrator roli bilan (superuser emas) yurgizadi.
 */
describeWithPostgres('BE-36 servis DB rollari (PostgreSQL)', () => {
  const suffix = `${process.pid}${Date.now() % 100_000}`;
  const prefix = `be36r${suffix}_`;
  const database = `be36_roles_${suffix}_test`;
  const target = new URL(url!);
  const urlOf = (user: string) => {
    const conn = new URL(url!);
    conn.username = user;
    conn.password = 'x';
    conn.pathname = `/${database}`;
    return conn.toString();
  };
  const as = (user: string) => new Client({ connectionString: urlOf(user) });
  /** Servis kabi ulanish sozlamasi — o‘z roli bilan. */
  const serviceConfig = (schema: string, user: string) =>
    new ConfigService({
      DB_HOST: target.hostname,
      DB_PORT: Number(target.port || 5432),
      DB_NAME: database,
      [`DB_USERNAME_${schema.toUpperCase()}`]: user,
      [`DB_PASSWORD_${schema.toUpperCase()}`]: 'x',
    });
  let admin: Client;
  let roles: string[] = [];
  let migrateExit: number | null = null;
  const migrateLog: string[] = [];

  beforeAll(async () => {
    if (!target.pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${database}`);
    const db = new Client({
      connectionString: Object.assign(new URL(url!), {
        pathname: `/${database}`,
      }).toString(),
    });
    await db.connect();
    try {
      // skriptning o‘zi; faqat rol nomlari testga xos (rollar klaster bo‘yicha umumiy)
      await db.query(
        readFileSync(BOOTSTRAP, 'utf8').replace(/\bmkt_/g, prefix),
      );
    } finally {
      await db.end();
    }
    roles = (
      await admin.query(
        `SELECT rolname FROM pg_roles WHERE rolname LIKE $1 ORDER BY rolname`,
        [`${prefix}%`],
      )
    ).rows.map((row: { rolname: string }) => row.rolname);
    // CI da parol bilan ulanish (scram) — bootstrapdagi CHANGE_ME_* o‘rniga testga xos parol
    for (const role of roles)
      await admin.query(`ALTER ROLE ${role} PASSWORD 'x'`);
    // haqiqiy migratsiya CLI migrator nomidan (bazada CREATE huquqi yo‘q): lead sxemasining hamma migratsiyasi
    migrateExit = await runMigrationCli(
      LEAD_DB,
      ['check'],
      {
        MIGRATE_DATABASE_URL: urlOf(`${prefix}migrator`),
        DB_USERNAME_LEAD: `${prefix}lead`,
      },
      (line) => migrateLog.push(line),
    );
    // qolgan jadvallarni ham migrator yaratadi
    const migrator = as(`${prefix}migrator`);
    await migrator.connect();
    try {
      await migrator.query(
        `CREATE TABLE catalog.product (id BIGSERIAL PRIMARY KEY, name TEXT)`,
      );
      await migrator.query(
        `CREATE TABLE checkout.parcel (id BIGSERIAL PRIMARY KEY, status TEXT)`,
      );
      await migrator.query(
        `CREATE TABLE lead.probe (id BIGSERIAL PRIMARY KEY, name TEXT)`,
      );
    } finally {
      await migrator.end();
    }
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      for (const role of roles)
        await admin.query(`DROP ROLE IF EXISTS ${role}`);
    } finally {
      await admin.end();
    }
  });

  it('bootstrap har servisga rol yaratadi — lead ham (10 sxema)', () => {
    expect(roles).toEqual(
      [
        'catalog',
        'checkout',
        'finance',
        'identity',
        'integration',
        'inventory',
        'lead',
        'migrator',
        'notification',
        'payment',
        'search',
      ].map((name) => `${prefix}${name}`),
    );
  });

  it('TC2: catalog roli o‘z sxemasida yozadi, checkout sxemasiga yozolmaydi va o‘qiyolmaydi; DDL yo‘q', async () => {
    const catalog = as(`${prefix}catalog`);
    await catalog.connect();
    try {
      await expect(
        catalog.query(
          `INSERT INTO catalog.product (name) VALUES ('quloqchin') RETURNING id`,
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        catalog.query(`INSERT INTO checkout.parcel (status) VALUES ('NEW')`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        catalog.query(`SELECT count(*) FROM checkout.parcel`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        catalog.query(`CREATE TABLE catalog.extra (id INT)`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await catalog.end();
    }
    // lead roli ham faqat o‘zida
    const lead = as(`${prefix}lead`);
    await lead.connect();
    try {
      await expect(
        lead.query(`INSERT INTO lead.probe (name) VALUES ('Aziza')`),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        lead.query(`UPDATE catalog.product SET name = 'x'`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await lead.end();
    }
  });

  it('migratsiya CLI migrator nomidan ishlaydi (bazada CREATE huquqisiz); servis roli migratsiya jadvallarini ishlatadi, jurnalini o‘zgartira olmaydi', async () => {
    expect({ exit: migrateExit, log: migrateLog }).toMatchObject({ exit: 0 });
    const lead = as(`${prefix}lead`);
    await lead.connect();
    try {
      // migrator yaratgan jadval — default huquqlar bilan servisga DML
      await expect(
        lead.query('SELECT count(*)::int AS n FROM lead.lead'),
      ).resolves.toMatchObject({ rows: [{ n: 0 }] });
      await expect(
        lead.query(
          `INSERT INTO lead.migrations ("timestamp", name) VALUES (1, 'soxta')`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(lead.query(`DELETE FROM lead.migrations`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await lead.end();
    }
  });

  it('servis o‘z roli bilan: sxema bor — ensureSchema o‘tadi; sxema yo‘q — tushunarli xato (bootstrap kerak)', async () => {
    await expect(
      ensureSchema(serviceConfig('lead', `${prefix}lead`), 'lead'),
    ).resolves.toBeUndefined();
    await expect(
      ensureSchema(serviceConfig('nosuch', `${prefix}lead`), 'nosuch'),
    ).rejects.toThrow(/00-bootstrap\.sql/);
  });
});

describe('BE-36 servis ulanish sozlamalari', () => {
  const config = (env: Record<string, string>) => new ConfigService(env);

  it('DB_USERNAME_<SXEMA> berilsa — servis o‘z roli bilan; rollar umuman yo‘q bo‘lsa — umumiy foydalanuvchi', () => {
    const env = {
      DB_HOST: 'db',
      DB_USERNAME: 'mkt_migrator',
      DB_PASSWORD: 'm',
      DB_USERNAME_CATALOG: ' mkt_catalog ',
      DB_PASSWORD_CATALOG: 'c',
    };
    expect(dbCredentials(config(env), 'catalog', env)).toEqual({
      user: 'mkt_catalog',
      password: 'c',
      perService: true,
    });
    expect(typeOrmOptions(config(env), 'catalog', [])).toMatchObject({
      username: 'mkt_catalog',
      password: 'c',
      schema: 'catalog',
    });
    const shared = { DB_USERNAME: 'marketplace', DB_PASSWORD: 'p' };
    expect(dbCredentials(config(shared), 'checkout', shared)).toEqual({
      user: 'marketplace',
      password: 'p',
      perService: false,
    });
  });

  it('rollar yoqilgan, lekin shu servisniki yo‘q yoki noto‘g‘ri yozilgan — servis ishga tushmaydi (umumiy foydalanuvchiga o‘tmaydi); parolsiz rol — xato', () => {
    const env = {
      DB_USERNAME: 'mkt_migrator',
      DB_PASSWORD: 'm',
      DB_USERNAME_CATALOG: 'mkt_catalog',
      DB_PASSWORD_CATALOG: 'c',
      DB_USERNAME_ELCHI_INTEGRATION: 'mkt_integration',
    };
    expect(() => dbCredentials(config(env), 'checkout', env)).toThrow(
      /DB_USERNAME_CHECKOUT/,
    );
    expect(() => dbCredentials(config(env), 'integration', env)).toThrow(
      /DB_USERNAME_INTEGRATION/,
    );
    const noPassword = { DB_USERNAME_LEAD: 'mkt_lead' };
    expect(() => dbCredentials(config(noPassword), 'lead', noPassword)).toThrow(
      /DB_PASSWORD_LEAD/,
    );
    // faqat bo‘sh joy — rol yo‘q (ikkala funksiyada bir xil)
    const blank = { DB_USERNAME_LEAD: ' ', DB_USERNAME: 'u', DB_PASSWORD: 'p' };
    expect(perServiceRolesEnabled(blank)).toBe(false);
    expect(dbCredentials(config(blank), 'lead', blank)).toMatchObject({
      user: 'u',
      perService: false,
    });
  });

  it('servis rollari yoqilgan bo‘lsa servis migratsiya qilmaydi (CLI, migrator nomidan)', () => {
    expect(perServiceRolesEnabled({ DB_USERNAME_LEAD: 'mkt_lead' })).toBe(true);
    expect(perServiceRolesEnabled({ DB_USERNAME_LEAD: ' ' })).toBe(false);
    expect(perServiceRolesEnabled({ DB_USERNAME: 'marketplace' })).toBe(false);
    expect(
      shouldRunMigrations(config({}), { DB_USERNAME_LEAD: 'mkt_lead' }),
    ).toBe(false);
    expect(shouldRunMigrations(config({}), {})).toBe(true);
    expect(
      shouldRunMigrations(
        new ConfigService({ DB_AUTO_MIGRATE: false } as never),
        {},
      ),
    ).toBe(false);
  });
});
