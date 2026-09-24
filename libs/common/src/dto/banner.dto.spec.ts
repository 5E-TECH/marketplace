import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  BANNER_SORT_ORDER_MAX,
  CreateBannerDto,
  MAX_BANNERS,
  ReorderBannersDto,
  UpdateBannerDto,
} from './banner.dto';

/** api-gateway main.ts dagi global pipe bilan bir xil sozlama. */
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const check = (metatype: new () => object, value: object) =>
  pipe.transform(value, { type: 'body', metatype });

const image =
  'https://api.elchimarket.uz/media/marketplace-media/banners/a.jpg';

describe('Banner DTO (C6.9)', () => {
  it.each([
    ['title', { title: null }],
    ['imageUrl', { imageUrl: null }],
    ['sortOrder', { sortOrder: null }],
    ['isActive', { isActive: null }],
  ])(
    'PATCH majburiy ustunga null yuborilsa 500 emas, 400: %s',
    async (_field, body) => {
      await expect(check(UpdateBannerDto, body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('PATCH yuborilmagan maydonlarni o‘tkazib yuboradi, nullable ustunlarga null ruxsat', async () => {
    await expect(
      check(UpdateBannerDto, {
        title: 'Yangi',
        linkUrl: null,
        startsAt: null,
        endsAt: null,
      }),
    ).resolves.toMatchObject({ title: 'Yangi', linkUrl: null });
    await expect(check(UpdateBannerDto, {})).resolves.toEqual({});
  });

  it('sortOrder INTEGER ustuniga sig‘maydigan bo‘lsa 400', async () => {
    const tooBig = BANNER_SORT_ORDER_MAX + 1;
    await expect(
      check(CreateBannerDto, {
        title: 'A',
        imageUrl: image,
        sortOrder: tooBig,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      check(UpdateBannerDto, { sortOrder: tooBig }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      check(ReorderBannersDto, { items: [{ id: '1', sortOrder: tooBig }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      check(CreateBannerDto, {
        title: 'A',
        imageUrl: image,
        sortOrder: BANNER_SORT_ORDER_MAX,
      }),
    ).resolves.toMatchObject({ sortOrder: BANNER_SORT_ORDER_MAX });
  });

  it.each([
    '/',
    '/katalog/telefon',
    '/product/12?rang=qora#sharh',
    'https://elchimarket.uz/aksiya',
    'HTTPS://instagram.com/elchimarket',
  ])('to‘g‘ri havola qabul qilinadi: %s', async (linkUrl) => {
    await expect(
      check(CreateBannerDto, { title: 'A', imageUrl: image, linkUrl }),
    ).resolves.toMatchObject({ linkUrl });
  });

  it.each([
    'katalog/telefon',
    'elchimarket.uz/aksiya',
    'www.instagram.com/elchimarket',
    '//evil.example.com',
    '/\\evil.example.com',
    'javascript:alert(1)',
    '/storefront/products?categoryId=7',
    '/api/backend/orders',
    '/katalog telefon',
  ])(
    'storefront bosa olmaydigan havola 400 bilan rad etiladi: %s',
    async (linkUrl) => {
      await expect(
        check(CreateBannerDto, { title: 'A', imageUrl: image, linkUrl }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(check(UpdateBannerDto, { linkUrl })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('bo‘sh havola — havolasiz banner', async () => {
    await expect(
      check(CreateBannerDto, { title: 'A', imageUrl: image, linkUrl: '' }),
    ).resolves.toMatchObject({ linkUrl: '' });
    await expect(
      check(CreateBannerDto, { title: 'A', imageUrl: image, linkUrl: null }),
    ).resolves.toMatchObject({ linkUrl: null });
  });

  it(`tartiblash ro‘yxati ${MAX_BANNERS} tadan oshmaydi`, async () => {
    const items = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: String(index + 1),
        sortOrder: index,
      }));
    await expect(
      check(ReorderBannersDto, { items: items(MAX_BANNERS) }),
    ).resolves.toBeDefined();
    await expect(
      check(ReorderBannersDto, { items: items(MAX_BANNERS + 1) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
