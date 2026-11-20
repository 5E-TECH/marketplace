import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_MONEY } from '../database/money.transformer';
import { AdminOrderRefundDto } from './admin-order.dto';
import { UpdateAdminSettingsDto } from './admin-settings.dto';
import { CreateProductDto } from './product.dto';
import { CreateProductVariantDto } from './product-variant.dto';
import { AdminReturnRefundDto } from './return-request.dto';
import { SearchProductsQueryDto } from './search.dto';
import { StorefrontProductsQueryDto } from './storefront.dto';

/**
 * BE-01: pul butun so‘mda (TZ T9-1). Har pul maydoni kasrni rad etadi va
 * butun qiymatni qabul qiladi. Faqat shu maydon xatolari tekshiriladi —
 * DTO ning qolgan majburiy maydonlari bu testning ishi emas.
 */
describe('Pul DTO maydonlari — butun so‘m (BE-01)', () => {
  type Case = [string, new () => object, string, number];
  const bodyCases: Case[] = [
    ['CreateProductDto', CreateProductDto, 'price', 150000],
    ['CreateProductDto', CreateProductDto, 'oldPrice', 180000],
    ['CreateProductVariantDto', CreateProductVariantDto, 'price', 150000],
    ['CreateProductDto', CreateProductDto, 'basePrice', 140000],
    ['CreateProductDto', CreateProductDto, 'affiliateFee', 65000],
    [
      'UpdateAdminSettingsDto',
      UpdateAdminSettingsDto,
      'minimumOrderAmount',
      50000,
    ],
    ['AdminReturnRefundDto', AdminReturnRefundDto, 'amount', 150000],
    ['AdminOrderRefundDto', AdminOrderRefundDto, 'amount', 150000],
  ];
  // Filtrlar kasrni rad etmaydi — butunga keltiradi (pastdagi test).
  const queryCases: Case[] = [
    [
      'StorefrontProductsQueryDto',
      StorefrontProductsQueryDto,
      'minPrice',
      10000,
    ],
    ['SearchProductsQueryDto', SearchProductsQueryDto, 'maxPrice', 90000],
  ];
  const cases = [...bodyCases, ...queryCases];

  async function errorsFor(
    dto: new () => object,
    field: string,
    value: unknown,
  ) {
    const errors = await validate(plainToInstance(dto, { [field]: value }));
    return errors.filter((error) => error.property === field);
  }

  it.each(bodyCases)(
    '%s.%s: kasr rad etiladi',
    async (_name, dto, field, value) => {
      const errors = await errorsFor(dto, field, value + 0.5);
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toHaveProperty('isInt');
    },
  );

  it.each(cases)(
    '%s.%s: butun son qabul qilinadi',
    async (_name, dto, field, value) => {
      expect(await errorsFor(dto, field, value)).toHaveLength(0);
    },
  );

  it.each(cases)(
    '%s.%s: MAX_MONEY dan katta rad etiladi',
    async (_name, dto, field) => {
      const errors = await errorsFor(dto, field, MAX_MONEY + 1);
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toHaveProperty('max');
    },
  );

  it('narx filtri: URL dagi kasr butunga keltiriladi (min yuqoriga, max pastga)', () => {
    expect(
      plainToInstance(SearchProductsQueryDto, {
        minPrice: '1500.5',
        maxPrice: '9000.9',
      }),
    ).toMatchObject({ minPrice: 1501, maxPrice: 9000 });
    expect(
      plainToInstance(StorefrontProductsQueryDto, { minPrice: '1500.5' }),
    ).toMatchObject({ minPrice: 1501 });
  });

  it('komissiya foizi kasrligicha qoladi (pul emas)', async () => {
    expect(
      await errorsFor(UpdateAdminSettingsDto, 'commissionPercent', 7.5),
    ).toHaveLength(0);
  });
});
