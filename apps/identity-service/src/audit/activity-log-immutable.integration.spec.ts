import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { IDENTITY_DB } from '../database';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
/** team/new-roles.integration.spec.ts dagi bilan bir xil: identity sxemasini DROP/CREATE qiladigan spec’lar ketma-ket. */
const IDENTITY_SCHEMA_TEST_LOCK = 2_304_003;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/** BE-27 (ADM-6, TC3): audit jurnali bazada ham o‘zgarmaydi — UPDATE, DELETE va TRUNCATE rad etiladi. */
describeWithPostgres('BE-27: activity_log o‘zgarmas (PostgreSQL)', () => {
  let dataSource: DataSource;
  let schemaLock: Client | undefined;

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
    dataSource = await new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      schema: 'identity',
      migrations: IDENTITY_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DROP SCHEMA IF EXISTS identity CASCADE');
      await dataSource.destroy();
    }
    if (schemaLock) {
      await schemaLock.query('SELECT pg_advisory_unlock($1)', [
        IDENTITY_SCHEMA_TEST_LOCK,
      ]);
      await schemaLock.end();
    }
  });

  it('yozuv qo‘shiladi; UPDATE, DELETE, TRUNCATE — rad, yozuv joyida', async () => {
    await dataSource.query(
      `INSERT INTO identity.activity_log (actor_id, action, entity_type, entity_id)
       VALUES (7, 'finance.setting.update', 'FinanceSetting', 'refusal_fee')`,
    );
    await expect(
      dataSource.query(`UPDATE identity.activity_log SET is_deleted = TRUE`),
    ).rejects.toThrow('Audit yozuvini o‘zgartirib yoki o‘chirib bo‘lmaydi');
    await expect(
      dataSource.query(`DELETE FROM identity.activity_log`),
    ).rejects.toThrow('Audit yozuvini o‘zgartirib yoki o‘chirib bo‘lmaydi');
    await expect(
      dataSource.query(`TRUNCATE identity.activity_log`),
    ).rejects.toThrow('Audit jurnalini tozalab bo‘lmaydi');
    const [{ n }] = (await dataSource.query(
      `SELECT count(*)::int AS n FROM identity.activity_log WHERE is_deleted = FALSE`,
    )) as Array<{ n: number }>;
    expect(n).toBe(1);
  });
});
