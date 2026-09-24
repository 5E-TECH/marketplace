import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { MAX_BANNERS } from '@app/common';
import { BannerService } from './banner.service';
import { Banner } from './entities/banner.entity';
import { CreateBanners1726588800000 } from './migrations/1726588800000-create-banners';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

const MEDIA = 'https://api.elchimarket.uz/media/marketplace-media';
const config = {
  getOrThrow: () => 'https://api.elchimarket.uz/media',
  get: () => 'marketplace-media',
};

/**
 * C6.9 — haqiqiy PostgreSQL ustida. Faqat `catalog.banner` jadvaliga
 * tegadi: boshqa catalog jadvallari saqlanib qoladi.
 *   TEST_DATABASE_URL=postgresql://.../marketplace_payment_test npx jest banner.integration
 */
describeWithPostgres('BannerService PostgreSQL (C6.9)', () => {
  let dataSource: DataSource;
  let service: BannerService;

  const insert = (sql: string) => dataSource.query(sql);
  const titles = async () =>
    (await service.storefrontList()).map((banner) => banner.title);

  beforeAll(async () => {
    const databaseUrl = new URL(testDatabaseUrl!);
    if (!databaseUrl.pathname.toLowerCase().includes('test')) {
      throw new Error(
        'TEST_DATABASE_URL faqat nomida "test" bor alohida bazaga ishora qilishi kerak',
      );
    }
    const admin = new Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query('CREATE SCHEMA IF NOT EXISTS catalog');
    await admin.query('DROP TABLE IF EXISTS catalog.banner CASCADE');
    await admin.end();

    dataSource = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      schema: 'catalog',
      entities: [Banner],
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await new CreateBanners1726588800000().up(runner);
    await runner.release();
    service = new BannerService(
      dataSource.getRepository(Banner),
      config as never,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DROP TABLE IF EXISTS catalog.banner CASCADE');
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE catalog.banner RESTART IDENTITY');
  });

  it('TC2/TC3: storefront faqat faol, boshlangan va tugamagan bannerni oladi', async () => {
    await insert(`INSERT INTO catalog.banner (title,image_url,sort_order,is_active,starts_at,ends_at) VALUES
      ('Muddatsiz', '${MEDIA}/banners/a.jpg', 3, true,  NULL, NULL),
      ('Tugagan',   '${MEDIA}/banners/b.jpg', 1, true,  now() - interval '2 day', now() - interval '1 day'),
      ('Kelgusi',   '${MEDIA}/banners/c.jpg', 2, true,  now() + interval '1 day', NULL),
      ('Nofaol',    '${MEDIA}/banners/d.jpg', 0, false, NULL, NULL),
      ('Joriy',     '${MEDIA}/banners/e.jpg', 4, true,  now() - interval '1 day', now() + interval '1 day')`);
    await expect(titles()).resolves.toEqual(['Muddatsiz', 'Joriy']);
  });

  it('storefront sortOrder, keyin id bo‘yicha tartiblab, 12 tagacha qaytaradi', async () => {
    const values = Array.from(
      { length: 14 },
      (_, index) =>
        `('B${index + 1}', '${MEDIA}/banners/x.jpg', ${index < 2 ? 0 : 20 - index})`,
    ).join(',');
    await insert(
      `INSERT INTO catalog.banner (title,image_url,sort_order) VALUES ${values}`,
    );
    const result = await titles();
    expect(result).toHaveLength(12);
    // sort_order 0 li ikkitasi (id bo'yicha) birinchi, keyin sort_order o'sish tartibida.
    expect(result.slice(0, 3)).toEqual(['B1', 'B2', 'B14']);
  });

  it('TC1/TC4: yaratiladi, tahrirlanadi va o‘chiriladi', async () => {
    const created = await service.create({
      title: 'Aksiya',
      imageUrl: `${MEDIA}/banners/a.jpg`,
      linkUrl: '/katalog/telefon',
    });
    const updated = await service.update(created.id, { title: 'Yangi' });
    expect(updated).toMatchObject({
      title: 'Yangi',
      linkUrl: '/katalog/telefon',
      isActive: true,
    });
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
    await service.remove(created.id);
    await expect(titles()).resolves.toEqual([]);
  });

  it('o‘chirilgan banner tartiblash yoki tahrir orqali qayta paydo bo‘lmaydi', async () => {
    const banner = await service.create({
      title: 'A',
      imageUrl: `${MEDIA}/banners/a.jpg`,
    });
    await service.remove(banner.id);
    await expect(
      service.reorder({ items: [{ id: banner.id, sortOrder: 5 }] }),
    ).rejects.toThrow('topilmadi');
    await expect(service.update(banner.id, { title: 'B' })).rejects.toThrow(
      'topilmadi',
    );
    await expect(
      dataSource.query('SELECT count(*)::int AS n FROM catalog.banner'),
    ).resolves.toEqual([{ n: 0 }]);
  });

  it('tartiblashda bittasi topilmasa hech biri o‘zgarmaydi', async () => {
    const a = await service.create({
      title: 'A',
      imageUrl: `${MEDIA}/banners/a.jpg`,
      sortOrder: 1,
    });
    await expect(
      service.reorder({
        items: [
          { id: a.id, sortOrder: 9 },
          { id: '999', sortOrder: 0 },
        ],
      }),
    ).rejects.toThrow('topilmadi');
    await expect(
      dataSource.query('SELECT sort_order FROM catalog.banner WHERE id=$1', [
        a.id,
      ]),
    ).resolves.toEqual([{ sort_order: 1 }]);
  });

  it('bannerlar soni chegaradan oshmaydi', async () => {
    await insert(
      `INSERT INTO catalog.banner (title,image_url)
       SELECT 'B' || g, '${MEDIA}/banners/x.jpg' FROM generate_series(1, ${MAX_BANNERS}) g`,
    );
    await expect(
      service.create({ title: 'Ortiqcha', imageUrl: `${MEDIA}/banners/a.jpg` }),
    ).rejects.toThrow(`${MAX_BANNERS} tadan oshmasligi`);
  });

  it('bigint chegarasidan katta id 500 emas, 404 beradi', async () => {
    await expect(service.remove('9999999999999999999')).rejects.toThrow(
      'topilmadi',
    );
  });

  it('DB CHECK teskari muddatni servisni chetlab o‘tganda ham rad etadi', async () => {
    await expect(
      insert(`INSERT INTO catalog.banner (title,image_url,starts_at,ends_at)
              VALUES ('x','${MEDIA}/banners/x.jpg', now(), now() - interval '1 day')`),
    ).rejects.toThrow('chk_catalog_banner_period');
  });
});
