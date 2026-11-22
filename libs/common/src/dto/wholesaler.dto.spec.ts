import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AdminCreateProductDto, AdminUpdateProductDto } from './product.dto';
import { CreateWholesalerDto, UpdateWholesalerDto } from './wholesaler.dto';

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

  it('BE-41: MXIK — 17 raqam, qadoq kodi — faqat raqam; bo‘shliqlar olinadi; PATCH da null — kodni o‘chirish', async () => {
    for (const bad of [
      { mxikCode: '0851700100100000' },
      { mxikCode: '0851700100100000A' },
      { packageCode: '15-00' },
      { packageCode: '' },
    ])
      await expect(
        check(AdminCreateProductDto, { ...product, ...bad }),
      ).rejects.toBeInstanceOf(BadRequestException);
    const parsed = (await check(AdminCreateProductDto, {
      ...product,
      mxikCode: ' 08517001001000000 ',
      packageCode: '1500012',
    })) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      mxikCode: '08517001001000000',
      packageCode: '1500012',
    });
    await expect(
      check(AdminUpdateProductDto, { mxikCode: null, packageCode: null }),
    ).resolves.toMatchObject({ mxikCode: null, packageCode: null });
  });

  it.each(['weightGrams', 'lengthMm', 'basePrice', 'name'])(
    'PATCH bilan %s ni null qilib bo‘lmaydi — 400',
    async (field) => {
      await expect(
        check(AdminUpdateProductDto, { [field]: null }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('optovik: shartnoma yoki nomni null qilib bo‘lmaydi; holat faqat ACTIVE yoki SUSPENDED', async () => {
    for (const body of [
      { contractNumber: null },
      { name: null },
      { status: 'REJECTED' },
    ])
      await expect(check(UpdateWholesalerDto, body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    await expect(
      check(UpdateWholesalerDto, { status: 'SUSPENDED' }),
    ).resolves.toMatchObject({ status: 'SUSPENDED' });
  });
});
