import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AdminCreateProductDto } from './product.dto';
import { CreateWholesalerDto } from './wholesaler.dto';

describe('BE-07 DTO: optovik va mahsulot', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  const wholesaler = {
    name: 'Gadget Trade MChJ',
    legalType: 'LEGAL_ENTITY',
    tin: '305123456',
    bankName: 'Kapitalbank',
    bankAccount: '20208000900123456001',
    bankMfo: '01158',
    contractNumber: 'K-2026/014',
    contractDate: '2026-11-20',
  };
  const product = {
    wholesalerId: '15',
    name: 'Simsiz quloqchin',
    imageUrl: 'https://cdn.example.com/q.jpg',
    basePrice: 140000,
    weightGrams: 450,
    lengthMm: 200,
    widthMm: 120,
    heightMm: 80,
  };
  const check = (metatype: new () => object, body: object) =>
    pipe.transform(body, { type: 'body', metatype });

  it('TC5: STIR, hisob raqami, MFO va shartnoma bilan optovik qabul qilinadi', async () => {
    await expect(
      check(CreateWholesalerDto, wholesaler),
    ).resolves.toBeInstanceOf(CreateWholesalerDto);
  });

  it.each([
    ['tin', '30512345'],
    ['bankAccount', '2020800090012345600'],
    ['bankMfo', '1158'],
    ['legalType', 'LLC'],
    ['contractDate', '20.11.2026'],
    ['contractNumber', ''],
  ])('noto‘g‘ri %s = %j — 400', async (field, value) => {
    await expect(
      check(CreateWholesalerDto, { ...wholesaler, [field]: value }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['weightGrams', 'lengthMm', 'widthMm', 'heightMm', 'basePrice'])(
    'TC3: %s siz mahsulot — 400',
    async (field) => {
      const body: Record<string, unknown> = { ...product };
      delete body[field];
      await expect(check(AdminCreateProductDto, body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('og‘irlik 0 yoki kasr — 400; holat (status) body da qabul qilinmaydi', async () => {
    await expect(
      check(AdminCreateProductDto, { ...product, weightGrams: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      check(AdminCreateProductDto, { ...product, weightGrams: 1.5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const parsed = (await check(AdminCreateProductDto, {
      ...product,
      status: 'ACTIVE',
      isBad: true,
    })) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('status');
    expect(parsed.isBad).toBe(true);
  });
});
