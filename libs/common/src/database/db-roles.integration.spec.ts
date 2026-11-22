import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import {
  dbCredentials,
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
 */
describeWithPostgres('BE-36 servis DB rollari (PostgreSQL)', () => {
  const suffix = `${process.pid}${Date.now() % 100_000}`;
  const prefix = `be36r${suffix}_`;
  const database = `be36_roles_${suffix}_test`;
  const target = new URL(url!);
  const as = (user: string, db = database) => {
    const conn = new URL(url!);
    conn.username = user;
    conn.password = 'x';
    conn.pathname = `/${db}`;
    return new Client({ connectionString: conn.toString() });
  };
  let admin: Client;
  let roles: string[] = [];

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
    // jadvallarni migrator yaratadi (migratsiya CLI kabi)
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
        `CREATE TABLE lead.lead (id BIGSERIAL PRIMARY KEY, name TEXT)`,
      );
    } finally {
      await migrator.end();
    }
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    for (const role of roles) await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
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
        lead.query(`INSERT INTO lead.lead (name) VALUES ('Aziza')`),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        lead.query(`UPDATE catalog.product SET name = 'x'`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await lead.end();
    }
  });
});

describe('BE-36 servis ulanish sozlamalari', () => {
  const config = (env: Record<string, string>) => new ConfigService(env);

  it('DB_USERNAME_<SXEMA> berilsa — servis o‘z roli bilan, aks holda umumiy foydalanuvchi', () => {
    const env = {
      DB_HOST: 'db',
      DB_USERNAME: 'mkt_migrator',
      DB_PASSWORD: 'm',
      DB_USERNAME_CATALOG: 'mkt_catalog',
      DB_PASSWORD_CATALOG: 'c',
    };
    expect(dbCredentials(config(env), 'catalog')).toEqual({
      user: 'mkt_catalog',
      password: 'c',
      perService: true,
    });
    expect(dbCredentials(config(env), 'checkout')).toEqual({
      user: 'mkt_migrator',
      password: 'm',
      perService: false,
    });
    expect(typeOrmOptions(config(env), 'catalog', [])).toMatchObject({
      username: 'mkt_catalog',
      password: 'c',
      schema: 'catalog',
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
