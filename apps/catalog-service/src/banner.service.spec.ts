import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, FindOperator, QueryResult } from 'typeorm';
import { MAX_BANNERS } from '@app/common';
import { BannerService } from './banner.service';
import { Banner } from './entities/banner.entity';

const MEDIA = 'https://api.elchimarket.uz/media/marketplace-media';
const config = {
  getOrThrow: () => 'https://api.elchimarket.uz/media/',
  get: () => 'marketplace-media',
};

/**
 * Xotiradagi repozitoriy. Storefront filtri bu yerda TEKSHIRILMAYDI — u
 * pastdagi "SQL" blokida TypeORM hosil qilgan haqiqiy so'rov bo'yicha
 * tekshiriladi (oldingi mock filtrni JS'da qayta yozgani uchun SQL buzilsa
 * ham testlar yashil qolardi).
 */
function setup(rows: Partial<Banner>[] = []) {
  let sequence = rows.length;
  const stamp = new Date('2026-09-22T10:00:00Z');
  const store: Banner[] = rows.map((row, index) => ({
    id: String(index + 1),
    title: 'Banner',
    imageUrl: `${MEDIA}/banners/b.jpg`,
    linkUrl: null,
    sortOrder: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...row,
  })) as Banner[];

  const byId = (id: unknown) => store.find((banner) => banner.id === id);
  const ids = (where: { id?: unknown }) =>
    where.id instanceof FindOperator ? (where.id.value as string[]) : null;
  const repository = {
    find: jest.fn(async (options: { where?: { id?: unknown } } = {}) => {
      const wanted = options.where ? ids(options.where) : null;
      return (
        wanted ? store.filter((row) => wanted.includes(row.id)) : [...store]
      )
        .map((row) => ({ ...row }))
        .sort(
          (a, b) => a.sortOrder - b.sortOrder || Number(a.id) - Number(b.id),
        );
    }),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
      const row = byId(where.id);
      return row ? { ...row } : null;
    }),
    findOneOrFail: jest.fn(async ({ where }: { where: { id: string } }) => ({
      ...byId(where.id)!,
    })),
    count: jest.fn(async () => store.length),
    create: jest.fn((value: Partial<Banner>) => ({ ...value }) as Banner),
    save: jest.fn(async (value: Banner) => {
      const saved = {
        ...value,
        id: String(++sequence),
        createdAt: stamp,
        updatedAt: stamp,
      };
      store.push(saved);
      return saved;
    }),
    update: jest.fn(async ({ id }: { id: string }, patch: Partial<Banner>) => {
      const row = byId(id);
      if (row) Object.assign(row, patch);
      return { affected: row ? 1 : 0 };
    }),
    delete: jest.fn(async ({ id }: { id: string }) => {
      const index = store.findIndex((row) => row.id === id);
      if (index >= 0) store.splice(index, 1);
      return { affected: index >= 0 ? 1 : 0 };
    }),
    manager: {} as Record<string, unknown>,
  };
  const manager = {
    query: jest.fn(async () => []),
    getRepository: () => repository,
    transaction: jest.fn((work: (m: unknown) => unknown) => work(manager)),
  };
  repository.manager = manager;
  return {
    service: new BannerService(repository as never, config as never),
    repository,
    manager,
    store,
  };
}

const past = new Date(Date.now() - 86_400_000);
const future = new Date(Date.now() + 86_400_000);
const image = `${MEDIA}/banners/autumn.jpg`;

describe('BannerService (C6.9)', () => {
  it('TC1: banner qo‘shiladi va admin ro‘yxatida ko‘rinadi', async () => {
    const { service } = setup();
    const created = await service.create({
      title: '  50% chegirma  ',
      imageUrl: `  ${image}  `,
      linkUrl: '/katalog/telefon',
      sortOrder: 5,
    });
    expect(created).toMatchObject({
      id: '1',
      title: '50% chegirma',
      imageUrl: image,
      linkUrl: '/katalog/telefon',
      sortOrder: 5,
      isActive: true,
      isVisible: true,
    });
    await expect(service.adminList()).resolves.toHaveLength(1);
  });

  it('mahsulot rasmini ham qabul qiladi (media omborining ochiq papkasi)', async () => {
    const { service } = setup();
    await expect(
      service.create({ title: 'A', imageUrl: `${MEDIA}/products/p.jpg` }),
    ).resolves.toMatchObject({ imageUrl: `${MEDIA}/products/p.jpg` });
  });

  it.each([
    ['boshqa host', 'https://cdn.example.com/banners/a.jpg'],
    ['yopiq papka', `${MEDIA}/private/a.jpg`],
    ['papkadan chiqish', `${MEDIA}/banners/../private/a.jpg`],
    [
      'boshqa bucket',
      'https://api.elchimarket.uz/media/other-bucket/banners/a.jpg',
    ],
    ['query qo‘shilgan', `${MEDIA}/banners/a.jpg?x=1`],
    ['URL emas', 'banner.jpg'],
  ])(
    'platforma media omboridan tashqaridagi rasm rad etiladi: %s',
    async (_case, imageUrl) => {
      const { service, repository } = setup();
      await expect(
        service.create({ title: 'A', imageUrl }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  it('bo‘sh havola null bo‘ladi, noto‘g‘ri havola rad etiladi', async () => {
    const { service } = setup();
    await expect(
      service.create({ title: 'A', imageUrl: image, linkUrl: '   ' }),
    ).resolves.toMatchObject({ linkUrl: null });
    for (const linkUrl of [
      'katalog/telefon',
      '//evil.com',
      '/\\evil.com',
      '/storefront/products',
    ]) {
      await expect(
        service.create({ title: 'A', imageUrl: image, linkUrl }),
      ).rejects.toThrow('Havola noto‘g‘ri');
    }
  });

  it('faqat bo‘sh joydan iborat sarlavha saqlanmaydi', async () => {
    const { service } = setup();
    await expect(
      service.create({ title: '   ', imageUrl: image }),
    ).rejects.toThrow('Sarlavha bo‘sh bo‘lmasligi kerak');
  });

  it('bannerlar soni chegaradan oshmaydi va chegara qulf ostida tekshiriladi', async () => {
    const rows = Array.from({ length: MAX_BANNERS }, () => ({}));
    const { service, manager, repository } = setup(rows);
    await expect(
      service.create({ title: 'A', imageUrl: image }),
    ).rejects.toThrow(`${MAX_BANNERS} tadan oshmasligi`);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      ['catalog:banner:create'],
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('tugash vaqti boshlanishdan oldin bo‘lsa rad etiladi', async () => {
    const { service } = setup();
    await expect(
      service.create({
        title: 'Xato',
        imageUrl: image,
        startsAt: future.toISOString(),
        endsAt: past.toISOString(),
      }),
    ).rejects.toThrow('boshlanish vaqtidan keyin');
  });

  it('tahrir faqat yuborilgan maydonlarni o‘zgartiradi', async () => {
    const { service, repository } = setup([
      { title: 'A', isActive: false, sortOrder: 7 },
    ]);
    await expect(
      service.update('1', { title: 'Yangi' }),
    ).resolves.toMatchObject({
      title: 'Yangi',
      isActive: false,
      sortOrder: 7,
    });
    expect(repository.update).toHaveBeenCalledWith(
      { id: '1' },
      { title: 'Yangi' },
    );
  });

  it('tahrir null qiymatda yiqilmaydi (DTO ni chetlab o‘tgan chaqiruv ham)', async () => {
    const { service, repository } = setup([{ title: 'A' }]);
    await expect(
      service.update('1', {
        title: null,
        sortOrder: null,
        isActive: null,
      } as never),
    ).resolves.toMatchObject({ title: 'A' });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('tahrirda muddat mavjud qiymat bilan birga tekshiriladi', async () => {
    const { service } = setup([{ title: 'A', startsAt: future }]);
    await expect(
      service.update('1', { endsAt: past.toISOString() }),
    ).rejects.toThrow('boshlanish vaqtidan keyin');
  });

  it('tahrirda muddatni tozalash mumkin', async () => {
    const { service } = setup([{ title: 'A', endsAt: future }]);
    await expect(
      service.update('1', { endsAt: null, isActive: false }),
    ).resolves.toMatchObject({
      endsAt: null,
      isActive: false,
      isVisible: false,
    });
  });

  it('tahrirda boshqa hostdagi rasm rad etiladi', async () => {
    const { service } = setup([{ title: 'A' }]);
    await expect(
      service.update('1', { imageUrl: 'https://cdn.example.com/x.jpg' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bigint chegarasidan katta id bazaga yetib bormay 404 beradi', async () => {
    const { service, repository } = setup([{ title: 'A' }]);
    for (const call of [
      () => service.update('9999999999999999999', { title: 'B' }),
      () => service.remove('9999999999999999999'),
      () =>
        service.reorder({
          items: [{ id: '9999999999999999999', sortOrder: 0 }],
        }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.find).not.toHaveBeenCalled();
  });

  it('TC4: o‘chirilgan banner ro‘yxatdan yo‘qoladi', async () => {
    const { service, store } = setup([{ title: 'Eski' }]);
    await expect(service.remove('1')).resolves.toEqual({
      id: '1',
      deleted: true,
    });
    expect(store).toHaveLength(0);
    await expect(service.remove('1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('abc')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('tartib o‘zgaradi va yangi ro‘yxat qaytadi', async () => {
    const { service } = setup([
      { title: 'A', sortOrder: 0 },
      { title: 'B', sortOrder: 1 },
    ]);
    const reordered = await service.reorder({
      items: [
        { id: '1', sortOrder: 10 },
        { id: '2', sortOrder: 0 },
      ],
    });
    expect(reordered.map((banner) => banner.title)).toEqual(['B', 'A']);
  });

  it('tartibda noma’lum id bo‘lsa hech biri o‘zgarmaydi', async () => {
    const { service, repository, store } = setup([
      { title: 'A', sortOrder: 0 },
    ]);
    await expect(
      service.reorder({
        items: [
          { id: '1', sortOrder: 5 },
          { id: '99', sortOrder: 0 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.update).not.toHaveBeenCalled();
    expect(store[0].sortOrder).toBe(0);
  });

  it('takroriy id bilan tartib rad etiladi', async () => {
    const { service } = setup([{ title: 'A' }]);
    await expect(
      service.reorder({
        items: [
          { id: '1', sortOrder: 0 },
          { id: '1', sortOrder: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('TC3: admin ro‘yxati muddati tugaganini isVisible=false bilan ko‘rsatadi', async () => {
    const { service } = setup([
      { title: 'Tugagan', endsAt: past },
      { title: 'Kelgusi', startsAt: future },
      { title: 'Nofaol', isActive: false },
      { title: 'Joriy', startsAt: past, endsAt: future },
    ]);
    const list = await service.adminList();
    expect(
      Object.fromEntries(
        list.map((banner) => [banner.title, banner.isVisible]),
      ),
    ).toEqual({
      Tugagan: false,
      Kelgusi: false,
      Nofaol: false,
      Joriy: true,
    });
  });
});

class MetadataDataSource extends DataSource {
  async prepareMetadata() {
    await this.buildMetadatas();
  }
}

describe('BannerService storefront SQL (TC2/TC3)', () => {
  it('faol, boshlangan va tugamagan bannerlarni tartib va limit bilan so‘raydi', async () => {
    // Haqiqiy TypeORM query builder ishlaydi; faqat bazaga yuborish to'xtatilgan.
    const source = new MetadataDataSource({
      type: 'postgres',
      entities: [Banner],
    });
    await source.prepareMetadata();
    const runner = source.createQueryRunner();
    const result = new QueryResult();
    result.records = [];
    const query = jest.spyOn(runner, 'query').mockResolvedValue(result);
    jest.spyOn(source, 'createQueryRunner').mockReturnValue(runner);

    await new BannerService(
      source.getRepository(Banner),
      config as never,
    ).storefrontList();

    // Butun WHERE aniq tekshiriladi: `IS NULL OR` yoki is_active olib tashlansa test yiqiladi.
    expect(query.mock.calls[0][0]).toContain(
      'WHERE "banner"."is_active" = true ' +
        'AND ("banner"."starts_at" IS NULL OR "banner"."starts_at" <= now()) ' +
        'AND ("banner"."ends_at" IS NULL OR "banner"."ends_at" > now()) ' +
        'ORDER BY "banner"."sort_order" ASC, "banner"."id" ASC LIMIT 12',
    );
  });
});
