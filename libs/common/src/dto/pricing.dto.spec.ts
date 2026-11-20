import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PricePolicyDto, ProductPricePolicyDto } from './pricing.dto';

describe('BE-09 narx DTO', () => {
  // gateway bilan bir xil sozlama (main.ts)
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const check = (metatype: new () => object, body: object) =>
    pipe.transform(body, { type: 'body', metatype });

  it.each([
    { kSale70: 0 },
    { kSale100: 0 },
    { targetMargin: 0 },
    { markupCapPercent: 50 },
    { adCost: 0 },
  ])(
    'admin mahsulot sozlamasida pul parametri (%j) — 400 (faqat superadmin, TZ 3)',
    async (body) => {
      await expect(check(ProductPricePolicyDto, body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('admin mahsulot uchun rejim va ko‘rinadigan summani beradi; null — yuqori darajadan', async () => {
    await expect(
      check(ProductPricePolicyDto, {
        deliveryMode: 'FREE',
        visibleCenter: null,
      }),
    ).resolves.toMatchObject({ deliveryMode: 'FREE', visibleCenter: null });
  });

  it('K 2 xonagacha kasr (Narx varag‘idagi aniq qiymat); 3 xona — 400', async () => {
    await expect(
      check(PricePolicyDto, { kSale100: 15231.75 }),
    ).resolves.toMatchObject({ kSale100: 15231.75 });
    await expect(
      check(PricePolicyDto, { kSale100: 15231.755 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
