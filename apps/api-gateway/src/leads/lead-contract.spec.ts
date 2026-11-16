import { NotImplementedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AdminLeadListItemDto,
  AdminLeadsQueryDto,
  AffiliateLeadRowDto,
  AffiliateOfferDto,
  AffiliateStatsRowDto,
  AffiliateStreamDto,
  CreateLeadDto,
  LeadCardDto,
  LeadHistoryEntryDto,
  LeadPreviousDto,
  LeadPriceDto,
  OperatorLeadListItemDto,
} from '@app/common';
import { RegionsController } from '../geo/regions.controller';
import { AdminLeadsController } from './admin-leads.controller';
import { AffiliateStreamsController } from './affiliate-streams.controller';
import { NOT_IMPLEMENTED } from './lead-stub';
import { OperatorLeadsController } from './operator-leads.controller';
import { PublicLeadsController } from './public-leads.controller';

const validLead = {
  code: 'k7Qm2x',
  name: 'Aziza',
  phone: '+998901234567',
  regionSoato: '1726',
  districtSoato: '1726266',
  addressLine: 'Turkiston ko‘chasi, 27-uy',
  whereDeliver: 'CENTER',
  consentVersion: '2026-11-16',
};

// @nestjs/swagger ichki metadata kaliti (DECORATORS.API_MODEL_PROPERTIES_ARRAY)
const SWAGGER_PROPS = 'swagger/apiModelPropertiesArray';

async function errorsIn(
  cls: new () => object,
  body: Record<string, unknown>,
): Promise<string[]> {
  // Global ValidationPipe bilan bir xil: whitelist + forbidNonWhitelisted (main.ts)
  const errors = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

const errorsOf = (body: Record<string, unknown>) =>
  errorsIn(CreateLeadDto, body);

function swaggerProps(dto: abstract new (...args: never[]) => unknown) {
  const props: string[] =
    Reflect.getMetadata(SWAGGER_PROPS, dto.prototype) ?? [];
  return props.map((p) => p.replace(/^:/, ''));
}

async function expect501(call: () => unknown, card: string) {
  let caught: unknown;
  try {
    await call();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(NotImplementedException);
  const ex = caught as NotImplementedException;
  expect(ex.getStatus()).toBe(501);
  expect(ex.getResponse()).toEqual({
    message: `Hali qurilmagan: ${card} da quriladi`,
    errorCode: NOT_IMPLEMENTED,
  });
}

describe('Lid shartnomasi (BE-25)', () => {
  it('TC5: to‘liq forma — xatosiz; variant s1/s3 yoki bo‘sh', async () => {
    await expect(errorsOf(validLead)).resolves.toEqual([]);
    await expect(errorsOf({ ...validLead, variant: 's3' })).resolves.toEqual(
      [],
    );
    await expect(errorsOf({ ...validLead, variant: 's2' })).resolves.toEqual([
      'variant',
    ]);
  });

  it('ism, telefon, viloyat, tuman, ko‘cha/uy va yetkazish turi majburiy (LID-2, P-1)', async () => {
    for (const field of [
      'name',
      'phone',
      'regionSoato',
      'districtSoato',
      'addressLine',
      'whereDeliver',
      'consentVersion',
    ]) {
      const body: Record<string, unknown> = { ...validLead };
      delete body[field];
      await expect(errorsOf(body)).resolves.toContain(field);
    }
  });

  it('«Markazgacha» tanlansa ham ko‘cha/uy bo‘sh bo‘lmaydi (ega javobi 2026-11-16)', async () => {
    await expect(
      errorsOf({ ...validLead, whereDeliver: 'CENTER', addressLine: '' }),
    ).resolves.toEqual(['addressLine']);
  });

  it('faqat bo‘shliqdan iborat ism va ko‘cha/uy — bo‘sh hisoblanadi', async () => {
    await expect(
      errorsOf({ ...validLead, addressLine: '   ', name: ' ' }),
    ).resolves.toEqual(expect.arrayContaining(['addressLine', 'name']));
  });

  it('yashirin maydonning har qanday qiymati 400 bermaydi — tuzoq oshkor bo‘lmaydi (BE-12)', async () => {
    for (const website of ['x'.repeat(300), 123, { a: 1 }])
      await expect(errorsOf({ ...validLead, website })).resolves.toEqual([]);
  });

  it('ID maydonlari faqat musbat son: noto‘g‘ri qiymat 500 emas, 400', async () => {
    await expect(errorsOf({ ...validLead, clickId: 'abc' })).resolves.toEqual([
      'clickId',
    ]);
    await expect(
      errorsIn(AdminLeadsQueryDto, { productId: 'abc', operatorId: '0' }),
    ).resolves.toEqual(['productId', 'operatorId']);
  });

  it('telefon faqat +998 va 9 raqam', async () => {
    await expect(
      errorsOf({ ...validLead, phone: '+99890123' }),
    ).resolves.toEqual(['phone']);
  });

  it('yashirin maydon va reklama parametrlari e’lon qilingan: whitelist ularni rad etmaydi', async () => {
    await expect(
      errorsOf({
        ...validLead,
        website: 'bot',
        sub1: 'a',
        utmSource: 'facebook',
        fbclid: 'x',
        clickId: '90311',
      }),
    ).resolves.toEqual([]);
  });

  it('variant sotuvchi, operator va admin javoblarida yo‘q (LID-8)', () => {
    for (const dto of [
      AffiliateOfferDto,
      AffiliateStreamDto,
      AffiliateStatsRowDto,
      LeadCardDto,
      LeadHistoryEntryDto,
      LeadPreviousDto,
      OperatorLeadListItemDto,
      AdminLeadListItemDto,
      AffiliateLeadRowDto,
      LeadPriceDto,
    ]) {
      expect(swaggerProps(dto)).not.toContain('variant');
    }
  });

  it('sotuvchining lid qatorida ism, manzil va to‘liq raqam yo‘q (BE-28)', () => {
    const props = swaggerProps(AffiliateLeadRowDto);
    for (const hidden of [
      'customerName',
      'name',
      'phone',
      'phoneMasked',
      'address',
      'addressLine',
      'regionSoato',
      'districtSoato',
    ])
      expect(props).not.toContain(hidden);
    expect(props).toContain('phoneLast4');
  });

  it('postback siri va CAPI tokeni javobda qaytmaydi (BE-11)', () => {
    const props = swaggerProps(AffiliateStreamDto);
    expect(props).not.toContain('postbackSecret');
    expect(props).not.toContain('capiToken');
    expect(props).toEqual(
      expect.arrayContaining(['hasPostbackSecret', 'hasCapiToken']),
    );
  });

  it('stublar 501 va NOT_IMPLEMENTED qaytaradi, kartasini aytadi', async () => {
    const pub = new PublicLeadsController();
    await expect501(() => pub.getLandingPage('k7Qm2x'), 'BE-11');
    await expect501(() => pub.createClick({ code: 'k7Qm2x' }), 'BE-11');
    await expect501(
      () => pub.createLead(validLead as unknown as CreateLeadDto),
      'BE-12',
    );

    const aff = new AffiliateStreamsController();
    await expect501(() => aff.listOffers({}), 'BE-11');
    await expect501(() => aff.createStream({ productId: '501' }), 'BE-11');
    await expect501(() => aff.listStreams({}), 'BE-11');
    await expect501(() => aff.updateStream('3301', {}), 'BE-11');
    await expect501(
      () => aff.stats({ from: '2026-12-01', to: '2026-12-31' }),
      'BE-28',
    );
    await expect501(
      () => aff.listLeads({ from: '2027-01-08', to: '2027-01-14' }),
      'BE-28',
    );

    const op = new OperatorLeadsController();
    await expect501(() => op.takeNext(), 'BE-13');
    await expect501(() => op.listMine(), 'BE-13');
    await expect501(() => op.getCard('7001'), 'BE-13');
    await expect501(
      () => op.submitResult('7001', { outcome: 'BUSY' } as never),
      'BE-13',
    );
    await expect501(() => op.updateAddress('7001', {} as never), 'BE-38');
    await expect501(
      () => op.quote('7001', { quantity: 2, whereDeliver: 'ADDRESS' } as never),
      'BE-13',
    );
    await expect501(() => op.setState({ state: 'ONLINE' } as never), 'BE-13');
    await expect501(() => op.queueSummary(), 'BE-13');
    await expect501(
      () => op.stats({ from: '2026-12-01', to: '2026-12-31' }),
      'BE-28',
    );

    const admin = new AdminLeadsController();
    await expect501(() => admin.list({}), 'BE-42');
    await expect501(() => admin.getCard('7001'), 'BE-42');

    const regions = new RegionsController({ send: jest.fn() } as never);
    await expect501(() => regions.getRegionTree(), 'BE-38');
  });
});
