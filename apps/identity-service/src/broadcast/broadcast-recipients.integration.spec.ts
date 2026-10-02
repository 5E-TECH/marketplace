import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { User } from '../entities/user.entity';
import { CreateUsers1722776400000 } from '../migrations/1722776400000-create-users';
import { AddUserShopOperator1722950000000 } from '../migrations/1722950000000-add-user-shop-operator';
import { AddUserIsBlocked1722950000001 } from '../migrations/1722950000001-add-user-is-blocked';
import { AddUserAuthVersion1725984000000 } from '../migrations/1725984000000-add-user-auth-version';
import { BroadcastRecipientsService } from './broadcast-recipients.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/**
 * C6.8 — ommaviy xabar qabul qiluvchilari HAQIQIY Postgres'da: rol,
 * faollik/blok/o'chirilganlik filtri va bigint id bo'yicha kursor.
 */
describeWithPostgres('BroadcastRecipientsService PostgreSQL (C6.8)', () => {
  let dataSource: DataSource;
  let service: BroadcastRecipientsService;

  beforeAll(async () => {
    const databaseUrl = new URL(testDatabaseUrl!);
    if (!databaseUrl.pathname.toLowerCase().includes('test')) {
      throw new Error(
        'TEST_DATABASE_URL faqat nomida "test" bor alohida bazaga ishora qilishi kerak',
      );
    }
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
      migrations: [
        CreateUsers1722776400000,
        AddUserShopOperator1722950000000,
        AddUserIsBlocked1722950000001,
        AddUserAuthVersion1725984000000,
      ],
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
        (1,'SELLER','S1','+998900000001','s1@x.uz','h',true,false,false),
        (2,'SELLER','S2','+998900000002',NULL,'h',true,false,false),
        (9,'BUYER','B1','+998900000009',NULL,'h',true,false,false),
        (10,'BUYER','B2','+998900000010',NULL,'h',true,false,false),
        (11,'OPERATOR','O1','+998900000011',NULL,'h',true,false,false),
        (12,'ADMIN','A1','+998900000012',NULL,'h',true,false,false),
        (13,'SUPERADMIN','SA','+998900000013',NULL,'h',true,false,false),
        (14,'SELLER','Blok','+998900000014',NULL,'h',true,true,false),
        (15,'BUYER','Nofaol','+998900000015',NULL,'h',false,false,false),
        (16,'BUYER','Ochirilgan','+998900000016',NULL,'h',true,false,true)`);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('auditoriya bo‘yicha son — adminlar, bloklangan, nofaol, o‘chirilgan kirmaydi', async () => {
    await expect(service.count('sellers')).resolves.toEqual({ count: 2 });
    await expect(service.count('buyers')).resolves.toEqual({ count: 2 });
    await expect(service.count('all')).resolves.toEqual({ count: 5 });
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
    expect(third).toEqual({
      items: [{ id: '11', phone: '+998900000011', email: null }],
      nextAfterId: null,
    });
  });
});
