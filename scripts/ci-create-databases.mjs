#!/usr/bin/env node
/**
 * CI (BE-04): bir Postgres xizmatida qo‘shimcha test bazalari — `node scripts/ci-create-databases.mjs <nom> ...`.
 * Ulanish `TEST_DATABASE_URL` dan (foydalanuvchi va parol), `postgres` bazasi orqali. Baza bor bo‘lsa — o‘tkaziladi.
 */
import pg from 'pg';

const source = process.env.TEST_DATABASE_URL;
if (!source) {
  console.error('TEST_DATABASE_URL yo‘q');
  process.exit(2);
}
const admin = new URL(source);
admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  for (const name of process.argv.slice(2)) {
    if (!/^[a-z0-9_]+$/.test(name))
      throw new Error(`noto‘g‘ri baza nomi: ${name}`);
    const { rowCount } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (rowCount) {
      console.log(`${name}: bor`);
      continue;
    }
    await client.query(`CREATE DATABASE "${name}"`);
    console.log(`${name}: yaratildi`);
  }
} finally {
  await client.end();
}
