import { NotImplementedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AdminLeadListItemDto,
  AffiliateOfferDto,
  AffiliateStatsRowDto,
  AffiliateStreamDto,
  CreateLeadDto,
  LeadCardDto,
  LeadHistoryEntryDto,
  LeadPreviousDto,
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

async function errorsOf(body: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateLeadDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

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
    ]) {
      expect(swaggerProps(dto)).not.toContain('variant');
    }
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

    const op = new OperatorLeadsController();
    await expect501(() => op.takeNext(), 'BE-13');
    await expect501(() => op.listMine(), 'BE-13');
    await expect501(() => op.getCard('7001'), 'BE-13');
    await expect501(
      () => op.submitResult('7001', { outcome: 'BUSY' } as never),
      'BE-13',
    );
    await expect501(() => op.updateAddress('7001', {} as never), 'BE-38');
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
