import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BannerService } from './banner.service';
import { Banner } from './entities/banner.entity';

describe('BannerService (C6.9)', () => {
  /**
   * Repozitoriyning xotiradagi o'rnini bosuvchi. `createQueryBuilder`
   * storefront filtri uchun — SQL shartlari o'rniga shu yerda muddat
   * mantiqi takrorlanadi va real so'rovdagi shartlar alohida tekshiriladi.
   */
  function setup(rows: Partial<Banner>[] = []) {
    let sequence = rows.length;
    const store: Banner[] = rows.map((row, index) => ({
      id: String(index + 1),
      title: 'Banner',
      imageUrl: 'https://cdn.example.com/b.jpg',
      linkUrl: null,
      sortOrder: 0,
      isActive: true,
      startsAt: null,
      endsAt: null,
      createdAt: new Date('2026-09-22T10:00:00Z'),
      updatedAt: new Date('2026-09-22T10:00:00Z'),
      ...row,
    })) as Banner[];

    const where: string[] = [];
    const banners = {
      find: jest.fn(
        async (options?: { where?: { id?: { _value?: string[] } } }) => {
          const ids = (options?.where?.id as { _value?: string[] })?._value;
          const rowsFound = ids
            ? store.filter((banner) => ids.includes(banner.id))
            : [...store];
          return rowsFound.sort(
            (a, b) => a.sortOrder - b.sortOrder || Number(a.id) - Number(b.id),
          );
        },
      ),
      findOne: jest.fn(
        async ({ where: { id } }: { where: { id: string } }) =>
          store.find((banner) => banner.id === id) ?? null,
      ),
      create: jest.fn((value: Partial<Banner>) => ({ ...value }) as Banner),
      save: jest.fn(async (value: Banner | Banner[]) => {
        for (const banner of Array.isArray(value) ? value : [value]) {
          if (!banner.id) {
            banner.id = String(++sequence);
            banner.createdAt = new Date('2026-09-22T10:00:00Z');
            banner.updatedAt = new Date('2026-09-22T10:00:00Z');
          }
          if (!store.includes(banner)) store.push(banner);
        }
        return value;
      }),
      remove: jest.fn(async (banner: Banner) => {
        store.splice(store.indexOf(banner), 1);
        return banner;
      }),
      createQueryBuilder: jest.fn(() => {
        const builder = {
          where: (sql: string) => (where.push(sql), builder),
          andWhere: (sql: string) => (where.push(sql), builder),
          orderBy: () => builder,
          addOrderBy: () => builder,
          getMany: async () => {
            const now = Date.now();
            return store
              .filter(
                (banner) =>
                  banner.isActive &&
                  (!banner.startsAt || banner.startsAt.getTime() <= now) &&
                  (!banner.endsAt || banner.endsAt.getTime() > now),
              )
              .sort(
                (a, b) =>
                  a.sortOrder - b.sortOrder || Number(a.id) - Number(b.id),
              );
          },
        };
        return builder;
      }),
    };
    return {
      service: new BannerService(banners as never),
      banners,
      store,
      where,
    };
  }

  const past = new Date(Date.now() - 86_400_000);
  const future = new Date(Date.now() + 86_400_000);

  it('TC1: banner qo‘shiladi va admin ro‘yxatida ko‘rinadi', async () => {
    const { service } = setup();
    const created = await service.create({
      title: '  50% chegirma  ',
      imageUrl: '  https://cdn.example.com/autumn.jpg  ',
      linkUrl: '/storefront/products?categoryId=7',
      sortOrder: 5,
    });
    expect(created).toMatchObject({
      id: '1',
      title: '50% chegirma',
      imageUrl: 'https://cdn.example.com/autumn.jpg',
      sortOrder: 5,
      isActive: true,
      isVisible: true,
    });
    await expect(service.adminList()).resolves.toHaveLength(1);
  });

  it('TC2: storefront faol bannerlarni tartib bilan oladi', async () => {
    const { service } = setup([
      { title: 'Ikkinchi', sortOrder: 20 },
      { title: 'Birinchi', sortOrder: 10 },
      { title: 'Nofaol', sortOrder: 1, isActive: false },
    ]);
    const banners = await service.storefrontList();
    expect(banners.map((banner) => banner.title)).toEqual([
      'Birinchi',
      'Ikkinchi',
    ]);
    // Public javobda faqat ko'rsatishga kerak bo'lgan maydonlar bo'lsin.
    expect(Object.keys(banners[0]).sort()).toEqual([
      'id',
      'imageUrl',
      'linkUrl',
      'sortOrder',
      'title',
    ]);
  });

  it('TC3: muddati tugagan va hali boshlanmagan banner ko‘rinmaydi', async () => {
    const { service, where } = setup([
      { title: 'Tugagan', endsAt: past },
      { title: 'Kelgusi', startsAt: future },
      { title: 'Joriy', startsAt: past, endsAt: future },
    ]);
    await expect(service.storefrontList()).resolves.toMatchObject([
      { title: 'Joriy' },
    ]);
    // Filtr SQL'da — muddatni tozalab yuradigan cron kerak emas.
    expect(where.join(' ')).toContain('startsAt <= now()');
    expect(where.join(' ')).toContain('endsAt > now()');
  });

  it('TC3: admin ro‘yxati muddati tugaganini isVisible=false bilan ko‘rsatadi', async () => {
    const { service } = setup([{ title: 'Tugagan', endsAt: past }]);
    await expect(service.adminList()).resolves.toMatchObject([
      { title: 'Tugagan', isActive: true, isVisible: false },
    ]);
  });

  it('TC4: o‘chirilgan banner ikkala ro‘yxatdan ham yo‘qoladi', async () => {
    const { service, store } = setup([{ title: 'Eski' }]);
    await expect(service.remove('1')).resolves.toEqual({
      id: '1',
      deleted: true,
    });
    expect(store).toHaveLength(0);
    await expect(service.adminList()).resolves.toEqual([]);
    await expect(service.storefrontList()).resolves.toEqual([]);
  });

  it('mavjud bo‘lmagan bannerni o‘chirishda 404', async () => {
    const { service } = setup();
    await expect(service.remove('99')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove('abc')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('tartib o‘zgartiriladi va yangi ro‘yxat qaytadi', async () => {
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

  it('tartibda noma’lum id bo‘lsa hech biri saqlanmaydi', async () => {
    const { service, banners, store } = setup([{ title: 'A', sortOrder: 0 }]);
    await expect(
      service.reorder({
        items: [
          { id: '1', sortOrder: 5 },
          { id: '99', sortOrder: 0 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(banners.save).not.toHaveBeenCalled();
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

  it('tugash vaqti boshlanishdan oldin bo‘lsa rad etiladi', async () => {
    const { service } = setup();
    await expect(
      service.create({
        title: 'Xato',
        imageUrl: 'https://cdn.example.com/b.jpg',
        startsAt: future.toISOString(),
        endsAt: past.toISOString(),
      }),
    ).rejects.toThrow('boshlanish vaqtidan keyin');
  });

  it('tahrirlashda muddatni tozalash mumkin', async () => {
    const { service } = setup([{ title: 'A', endsAt: future }]);
    await expect(
      service.update('1', { endsAt: null, isActive: false }),
    ).resolves.toMatchObject({
      endsAt: null,
      isActive: false,
      isVisible: false,
    });
  });
});
