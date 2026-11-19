import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { User } from '../entities/user.entity';
import { IDENTITY_DB } from '../database';
import { BroadcastRecipientsService } from './broadcast-recipients.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
/** team/new-roles.integration.spec.ts dagi bilan bir xil: identity sxemasini DROP/CREATE qiladigan spec’lar ketma-ket. */
const IDENTITY_SCHEMA_TEST_LOCK = 2_304_003;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/**
 * C6.8 — ommaviy xabar qabul qiluvchilari HAQIQIY Postgres'da: rol,
 * faollik/blok/o'chirilganlik filtri va bigint id bo'yicha kursor.
 */
describeWithPostgres('BroadcastRecipientsService PostgreSQL (C6.8)', () => {
  let dataSource: DataSource;
  let service: BroadcastRecipientsService;
  let schemaLock: Client | undefined;

  beforeAll(async () => {
    const databaseUrl = new URL(testDatabaseUrl!);
    if (!databaseUrl.pathname.toLowerCase().includes('test')) {
      throw new Error(
        'TEST_DATABASE_URL faqat nomida "test" bor alohida bazaga ishora qilishi kerak',
      );
    }
    // BE-05: identity sxemasini tashlaydigan boshqa spec bilan bir qulf
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

    dataSource = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      schema: 'identity',
      entities: [User],
      // BE-05: hamma identity migratsiyasi — yangi rollar CHECK i bilan
      migrations: IDENTITY_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    service = new BroadcastRecipientsService(dataSource.getRepository(User));

    // 9 va 10 — id tartibi satr emas, son bo'yicha bo'lishini tekshiradi.
    await dataSource.query(`
      INSERT INTO identity.users
        (id,role,name,phone,email,password_hash,is_active,is_blocked,is_deleted) VALUES
        (1,'AFFILIATE','S1','+998900000001','s1@x.uz','h',true,false,false),
        (2,'AFFILIATE','S2','+998900000002',NULL,'h',true,false,false),
        (9,'WHOLESALER','W1','+998900000009',NULL,'h',true,false,false),
        (10,'WHOLESALER','W2','+998900000010',NULL,'h',true,false,false),
        (11,'OPERATOR_LEAD','O1','+998900000011',NULL,'h',true,false,false),
        (12,'ADMIN','A1','+998900000012',NULL,'h',true,false,false),
        (13,'SUPERADMIN','SA','+998900000013',NULL,'h',true,false,false),
        (14,'AFFILIATE','Blok','+998900000014',NULL,'h',true,true,false),
        (15,'WHOLESALER','Nofaol','+998900000015',NULL,'h',false,false,false),
        (16,'WHOLESALER','Ochirilgan','+998900000016',NULL,'h',true,false,true)`);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    await schemaLock?.end(); // sessiya yopilsa qulf bo‘shaydi
  });

  it('auditoriya bo‘yicha son — xodimlar, bloklangan, nofaol, o‘chirilgan kirmaydi', async () => {
    await expect(service.count('sellers')).resolves.toEqual({ count: 2 });
    // BE-05: mijoz foydalanuvchi emas — qabul qiluvchi yo‘q
    await expect(service.count('buyers')).resolves.toEqual({ count: 0 });
    await expect(
      service.page({ audience: 'buyers', limit: 10 }),
    ).resolves.toEqual({ items: [], nextAfterId: null });
    await expect(service.count('all')).resolves.toEqual({ count: 4 });
  });

  it('BE-05: bazadagi rol CHECK i eski SELLER/BUYER ni qabul qilmaydi', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO identity.users (role,name,phone,password_hash) VALUES ('BUYER','X','+998900000099','h')`,
      ),
    ).rejects.toThrow(/chk_identity_users_role/);
    const columns = (await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='identity' AND table_name='users' AND column_name='shop_id'`,
    )) as unknown[];
    expect(columns).toEqual([]);
  });

  it('kursor bilan bo‘laklab — takrorsiz va hech kim tushib qolmaydi', async () => {
    const first = await service.page({ audience: 'all', limit: 2 });
    expect(first.items.map((row) => row.id)).toEqual(['1', '2']);
    expect(first.items[0]).toEqual({
      id: '1',
      phone: '+998900000001',
      email: 's1@x.uz',
    });
    const second = await service.page({
      audience: 'all',
      afterId: first.nextAfterId,
      limit: 2,
    });
    expect(second.items.map((row) => row.id)).toEqual(['9', '10']);
    const third = await service.page({
      audience: 'all',
      afterId: second.nextAfterId,
      limit: 2,
    });
    expect(third).toEqual({ items: [], nextAfterId: null });
  });
});
