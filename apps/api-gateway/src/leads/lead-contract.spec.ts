import { BadRequestException, NotImplementedException } from '@nestjs/common';
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
import { of } from 'rxjs';
import { AdminLeadsController } from './admin-leads.controller';
import { AdminOfferContentController } from './admin-offer-content.controller';
import { AffiliateStreamsController } from './affiliate-streams.controller';
import { ParseLeadIdPipe } from './lead-id.pipe';
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

  it('ID BIGINT chegarasidan oshsa ham 400 (9223372036854775807)', async () => {
    await expect(
      errorsOf({ ...validLead, clickId: '9223372036854775807' }),
    ).resolves.toEqual([]);
    await expect(
      errorsOf({ ...validLead, clickId: '9223372036854775808' }),
    ).resolves.toEqual(['clickId']);
  });

  it('yo‘ldagi :id ham tekshiriladi: abc, 0 va juda katta son — 400', () => {
    const pipe = new ParseLeadIdPipe();
    expect(pipe.transform('7001')).toBe('7001');
    for (const bad of ['abc', '0', '-1', '9223372036854775808', ''])
      expect(() => pipe.transform(bad)).toThrow(BadRequestException);
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
    const lead = { send: jest.fn() } as never;
    const pub = new PublicLeadsController(lead);
    await expect501(
      () => pub.createLead(validLead as unknown as CreateLeadDto),
      'BE-12',
    );

    const aff = new AffiliateStreamsController(lead);
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
    await expect501(() => op.updateAddress('7001', {} as never), 'BE-13');
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
  });

  describe('BE-11: endpointlar lead-service ga boradi', () => {
    const make = () => {
      const send = jest.fn(() => of({ ok: true }));
      return { send, client: { send } as never };
    };

    it('ochiq sahifa va klik: kod, IP va user agent bilan', async () => {
      const { send, client } = make();
      const pub = new PublicLeadsController(client);
      await pub.getLandingPage('k7Qm2x');
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.landing.get' },
        { code: 'k7Qm2x' },
      );
      await pub.createClick(
        { code: 'k7Qm2x', variant: 's3', sub1: 'a' } as never,
        '203.0.113.7',
        'Mozilla/5.0',
      );
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.click.create' },
        {
          click: { code: 'k7Qm2x', variant: 's3', sub1: 'a' },
          ip: '203.0.113.7',
          userAgent: 'Mozilla/5.0',
        },
      );
    });

    it('sotuvchi: sotuvchi ID si tokendan, so‘rovdan emas (SOT-3)', async () => {
      const { send, client } = make();
      const aff = new AffiliateStreamsController(client);
      await aff.createStream('77', { productId: '501' });
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.stream.create' },
        { affiliateId: '77', productId: '501' },
      );
      await aff.listStreams('77', { page: 2, limit: 10 });
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.stream.list' },
        { affiliateId: '77', page: 2, limit: 10 },
      );
      await aff.updateStream('77', '3301', { salePrice: 262000 });
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.stream.update' },
        { affiliateId: '77', streamId: '3301', patch: { salePrice: 262000 } },
      );
      await aff.listOffers({ minApproveRate: 50 });
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.offer.list' },
        { query: { minApproveRate: 50 } },
      );
    });

    it('admin offer matnlari: kim saqlagani tokendan', async () => {
      const { send, client } = make();
      const admin = new AdminOfferContentController(client);
      await admin.update('1', '501', { highlights: ['a'], boxContents: [] });
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.offer-content.update' },
        {
          productId: '501',
          actorId: '1',
          content: { highlights: ['a'], boxContents: [] },
        },
      );
    });
  });
});
