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
  FraudActionType,
  FraudDecisionDto,
  LeadCardDto,
  LeadHistoryEntryDto,
  LeadPreviousDto,
  LeadPriceDto,
  OperatorLeadListItemDto,
  ReopenLeadDto,
  Role,
  ROLES_KEY,
  TransferLeadDto,
  UpdateAffiliateStreamDto,
} from '@app/common';
import { of, throwError } from 'rxjs';
import { AdminFraudController } from './admin-fraud.controller';
import { AdminLeadsController } from './admin-leads.controller';
import { AdminOfferContentController } from './admin-offer-content.controller';
import { AffiliateStreamsController } from './affiliate-streams.controller';
import { ParseLeadIdPipe } from './lead-id.pipe';
import { NOT_IMPLEMENTED, notImplementedYet } from './lead-stub';
import { OperatorLeadsController } from './operator-leads.controller';
import { PublicLeadsController } from './public-leads.controller';
import { SupervisorLeadsController } from './supervisor-leads.controller';

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

  it('piksel ID: faqat raqam (Meta) va lotin harf/raqam (TikTok) — sahifaga skript kiritib bo‘lmaydi', async () => {
    await expect(
      errorsIn(UpdateAffiliateStreamDto, {
        metaPixelId: "1');import('//x.io/a.js');('",
      }),
    ).resolves.toEqual(['metaPixelId']);
    await expect(
      errorsIn(UpdateAffiliateStreamDto, { tiktokPixelId: 'C4AB<script>' }),
    ).resolves.toEqual(['tiktokPixelId']);
    await expect(
      errorsIn(UpdateAffiliateStreamDto, {
        metaPixelId: '1234567890',
        tiktokPixelId: 'C4ABC123XYZ',
      }),
    ).resolves.toEqual([]);
    await expect(
      errorsIn(UpdateAffiliateStreamDto, {
        metaPixelId: '',
        tiktokPixelId: '',
      }),
    ).resolves.toEqual([]);
  });

  it('admin offer matnlari faqat ADMIN va SUPERADMIN uchun', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminOfferContentController)).toEqual(
      [Role.ADMIN, Role.SUPERADMIN],
    );
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

  it('stub yordamchisi 501 va NOT_IMPLEMENTED qaytaradi, kartasini aytadi (BE-28 dan keyin stub qolmadi)', async () => {
    await expect501(() => notImplementedYet('BE-99'), 'BE-99');
  });

  it('BE-28: statistika endpointlari lead-service ga, sotuvchi va operator ID si tokendan', async () => {
    const send = jest.fn(() => of({ ok: true }));
    const client = { send } as never;
    const aff = new AffiliateStreamsController(client);
    const query = { from: '2026-12-01', to: '2026-12-31' };
    await aff.stats('77', query);
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'lead.stats.affiliate' },
      { affiliateId: '77', query },
    );
    await aff.listLeads('77', { ...query, page: 2 });
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'lead.stats.affiliate-leads' },
      { affiliateId: '77', query: { ...query, page: 2 } },
    );
    const op = new OperatorLeadsController(client);
    await op.stats('9', query);
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'lead.stats.operator' },
      { operatorId: '9', query },
    );
  });

  describe('BE-11: endpointlar lead-service ga boradi', () => {
    const make = () => {
      const send = jest.fn(() => of({ ok: true }));
      return { send, client: { send } as never };
    };

    it('ochiq sahifa, lid va klik: kod, IP va user agent bilan (BE-11, BE-12)', async () => {
      const { send, client } = make();
      const pub = new PublicLeadsController(client);
      await pub.getLandingPage('k7Qm2x');
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.landing.get' },
        { code: 'k7Qm2x' },
      );
      await pub.createLead(
        validLead as unknown as CreateLeadDto,
        '203.0.113.7',
        undefined,
      );
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.create' },
        { lead: validLead, ip: '203.0.113.7', userAgent: null },
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

  describe('BE-13: operator endpointlari lead-service ga, operator ID tokendan', () => {
    it('keyingi lid, ro‘yxat, karta, natija, manzil, summa, holat, xulosa', async () => {
      const send = jest.fn(() => of({}));
      const op = new OperatorLeadsController({ send } as never);
      const calls: Array<[() => unknown, string, unknown]> = [
        [() => op.takeNext('41'), 'lead.queue.next', { operatorId: '41' }],
        [() => op.listMine('41'), 'lead.queue.mine', { operatorId: '41' }],
        [
          () => op.getCard('41', '7001'),
          'lead.card.get',
          { operatorId: '41', leadId: '7001' },
        ],
        [
          () => op.submitResult('41', '7001', { outcome: 'BUSY' } as never),
          'lead.queue.result',
          { operatorId: '41', leadId: '7001', result: { outcome: 'BUSY' } },
        ],
        [
          () => op.updateAddress('41', '7001', { addressLine: 'x' } as never),
          'lead.queue.update-address',
          { operatorId: '41', leadId: '7001', address: { addressLine: 'x' } },
        ],
        [
          () =>
            op.quote('41', '7001', {
              quantity: 2,
              whereDeliver: 'ADDRESS',
            } as never),
          'lead.card.quote',
          {
            operatorId: '41',
            leadId: '7001',
            quantity: 2,
            whereDeliver: 'ADDRESS',
          },
        ],
        [
          () => op.setState('41', { state: 'ONLINE' } as never),
          'lead.operator.state',
          { operatorId: '41', state: 'ONLINE' },
        ],
        [() => op.queueSummary(), 'lead.queue.summary', {}],
      ];
      for (const [call, cmd, payload] of calls) {
        await call();
        expect(send).toHaveBeenLastCalledWith({ cmd }, payload);
      }
    });
  });

  describe('BE-42: admin lidlari', () => {
    it('ro‘yxat va karta lead-service ga; faqat ADMIN va SUPERADMIN (TC3: operator → 403)', async () => {
      const send = jest.fn(() => of({}));
      const admin = new AdminLeadsController({ send } as never);
      await admin.list({ status: 'NEW' as never, page: 2 });
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.admin.list' },
        { query: { status: 'NEW', page: 2 } },
      );
      await admin.getCard('7001');
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.admin.card' },
        { leadId: '7001' },
      );
      expect(Reflect.getMetadata(ROLES_KEY, AdminLeadsController)).toEqual([
        Role.ADMIN,
        Role.SUPERADMIN,
      ]);
    });
  });

  describe('BE-35: nazoratchi, qayta ochish, firibgarlik markazi', () => {
    it('TC5: qayta ochish va firibgarlik — faqat ADMIN va SUPERADMIN (operator → 403); kim — tokendan', async () => {
      const send = jest.fn(() => of({}));
      await new AdminLeadsController({ send } as never).reopen('7', '1092', {
        reason: 'Mijoz qayta so‘radi',
      });
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.admin.reopen' },
        { actorId: '7', leadId: '1092', reason: 'Mijoz qayta so‘radi' },
      );
      for (const ctrl of [
        AdminLeadsController,
        AdminFraudController,
        SupervisorLeadsController,
      ])
        expect(Reflect.getMetadata(ROLES_KEY, ctrl)).toEqual([
          Role.ADMIN,
          Role.SUPERADMIN,
        ]);
      expect(await errorsIn(ReopenLeadDto, { reason: '   ' })).toEqual([
        'reason',
      ]);
      expect(await errorsIn(ReopenLeadDto, {})).toEqual(['reason']);
    });

    it('qizil ro‘yxat va o‘tkazish lead-service ga; operator ID si tekshiriladi', async () => {
      const send = jest.fn(() => of({}));
      const sup = new SupervisorLeadsController({ send } as never);
      await sup.redList();
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.supervisor.red-list' },
        {},
      );
      await sup.transfer('7', '1277', { operatorId: '41' });
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.supervisor.transfer' },
        { actorId: '7', leadId: '1277', transfer: { operatorId: '41' } },
      );
      await sup.transfers({ date: '2027-01-14' });
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.supervisor.transfers' },
        { date: '2027-01-14' },
      );
      expect(await errorsIn(TransferLeadDto, { operatorId: 'abc' })).toEqual([
        'operatorId',
      ]);
    });

    it('BLOCK_AFFILIATE: avval qaror (lead-service), keyin identity da blok; identity xatosi — 502; boshqa choralar faqat lead-service', async () => {
      const calls: string[] = [];
      const lead = jest.fn((pattern: { cmd: string }) => {
        calls.push(pattern.cmd);
        return of({ id: '12', affiliateId: '42' });
      });
      const identity = jest.fn((pattern: { cmd: string }) => {
        calls.push(pattern.cmd);
        return of({});
      });
      const ctrl = new AdminFraudController(
        { send: lead } as never,
        { send: identity } as never,
      );
      const block = {
        action: FraudActionType.BLOCK_AFFILIATE,
        reason: 'Uchinchi marta o‘z buyurtmasi',
      } as FraudDecisionDto;
      await ctrl.decide('7', '12', block);
      expect(lead).toHaveBeenCalledWith(
        { cmd: 'lead.fraud.decide' },
        { actorId: '7', id: '12', decision: block },
      );
      expect(identity).toHaveBeenCalledWith(
        { cmd: 'identity.user.set-blocked' },
        { actorId: '7', userId: '42', blocked: true },
      );
      expect(calls).toEqual(['lead.fraud.decide', 'identity.user.set-blocked']);
      identity.mockImplementationOnce(() =>
        throwError(() => new Error('identity ishlamayapti')),
      );
      await expect(ctrl.decide('7', '12', block)).rejects.toMatchObject({
        status: 502,
      });
      identity.mockClear();
      await ctrl.decide('7', '12', {
        action: FraudActionType.WARN,
        reason: 'x',
      } as FraudDecisionDto);
      expect(identity).not.toHaveBeenCalled();
      expect(
        await errorsIn(FraudDecisionDto, {
          action: 'REVIEW_HOLD',
          reason: 'x',
        }),
      ).toEqual(['action']);
      expect(
        await errorsIn(FraudDecisionDto, { action: 'WARN', reason: '' }),
      ).toEqual(['reason']);
    });
  });

  describe('BE-43: lid API si', () => {
    it('partner/leads: kalit va Idempotency-Key sarlavhadan; api-keys sotuvchi ID si tokendan', async () => {
      const send = jest.fn(() => of({}));
      const pub = new PublicLeadsController({ send } as never);
      await pub.createPartnerLead(
        { code: 'k7Qm2x' } as never,
        'elk_x',
        'ord-1',
        '203.0.113.7',
        undefined,
      );
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.partner.create' },
        {
          lead: { code: 'k7Qm2x' },
          apiKey: 'elk_x',
          idempotencyKey: 'ord-1',
          ip: '203.0.113.7',
          userAgent: null,
        },
      );
      const aff = new AffiliateStreamsController({ send } as never);
      await aff.createApiKey('77');
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.api-key.create' },
        { affiliateId: '77' },
      );
      await aff.revokeApiKey('77', '12');
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'lead.api-key.revoke' },
        { affiliateId: '77', id: '12' },
      );
    });
  });
});
