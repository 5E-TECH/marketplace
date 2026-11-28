import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  AffiliateCapiEvent,
  AffiliatePostbackStatus,
  CatalogOfferSnapshot,
  CheckoutDeliveryDestination,
  encryptSecret,
  LeadOrderStatus,
  LeadSource,
} from '@app/common';
import { orderEvent } from '../../finance-service/src/ledger/order-events.samples';
import {
  buildCapiEvent,
  CapiResponse,
  CapiService,
  fbcFrom,
  hashPhone,
  isPermanentGraphError,
} from './capi.service';
import { CapiDelivery, Click, LEAD_ENTITIES, Lead, Stream } from './entities';
import { LeadAddressService } from './lead-address.service';
import { LeadIntakeService } from './lead-intake.service';
import { LeadOrderService } from './lead-order.service';
import { CreateLeadTables1794787200000 } from './migrations/1794787200000-create-lead-tables';
import { CreateOfferContent1794873600000 } from './migrations/1794873600000-create-offer-content';
import { AddLeadReview1794960000000 } from './migrations/1794960000000-add-lead-review';
import { AddLeadQueue1795046400000 } from './migrations/1795046400000-add-lead-queue';
import { AddApiLeads1795132800000 } from './migrations/1795132800000-add-api-leads';
import { AddLeadStats1795564800000 } from './migrations/1795564800000-add-lead-stats';
import { AddCapiFields1795651200000 } from './migrations/1795651200000-add-capi-fields';
import { AddFraudCenter1795824000000 } from './migrations/1795824000000-add-fraud-center';
import { SiteOrder1798070400000 } from './migrations/1798070400000-site-order';
import { OperatorStateSince1798416000000 } from './migrations/1798416000000-operator-state-since';
import { Telephony1798675200000 } from './migrations/1798675200000-telephony';
import { LeadUpsell1799366400000 } from './migrations/1799366400000-lead-upsell';
import { OperatorBonus1799452800000 } from './migrations/1799452800000-operator-bonus';

describe('BE-31: CAPI hodisasi (sof funksiyalar)', () => {
  const base = {
    event: AffiliateCapiEvent.LEAD,
    leadId: '7001',
    orderId: null,
    productId: '501',
    quantity: 1,
    eventTime: new Date('2027-01-14T09:32:00.000Z'),
    sourceUrl: 'https://land.example.uz/k7Qm2x',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
    fbp: 'fb.1.1700000000000.123',
    fbc: undefined,
    phoneE164: '+998901234567',
    sendPhone: false,
    value: null,
  };

  it('TC4: event_id = lid ID; website maydonlari; telefon sukut bo‘yicha yuborilmaydi (EQ-10)', () => {
    expect(buildCapiEvent(base)).toEqual({
      event_name: 'Lead',
      event_time: Math.floor(base.eventTime.getTime() / 1000),
      event_id: '7001',
      action_source: 'website',
      event_source_url: 'https://land.example.uz/k7Qm2x',
      user_data: {
        client_ip_address: '203.0.113.7',
        client_user_agent: 'Mozilla/5.0',
        fbp: 'fb.1.1700000000000.123',
      },
      custom_data: { content_type: 'product', content_ids: ['501'] },
    });
  });

  it('telefon: faqat raqamlar mamlakat kodi bilan, SHA-256 (sozlama yoqilganda)', () => {
    const expected = createHash('sha256').update('998901234567').digest('hex');
    expect(hashPhone('+998901234567')).toBe(expected);
    expect(
      (
        buildCapiEvent({ ...base, sendPhone: true }).user_data as {
          ph: string[];
        }
      ).ph,
    ).toEqual([expected]);
  });

  it('TC2: Purchase — summa UZS, mahsulot va buyurtma raqami', () => {
    expect(
      buildCapiEvent({
        ...base,
        event: AffiliateCapiEvent.PURCHASE,
        orderId: '9001',
        quantity: 2,
        value: 292000,
      }),
    ).toMatchObject({
      event_name: 'Purchase',
      event_id: '7001',
      custom_data: {
        value: 292000,
        currency: 'UZS',
        contents: [{ id: '501', quantity: 2 }],
        order_id: '9001',
      },
    });
  });

  it('fbc: cookie bo‘lmasa fbclid dan; Graph xato kodlari', () => {
    const at = new Date(1700000000000);
    expect(fbcFrom('fb.1.1.x', 'abc', at)).toBe('fb.1.1.x');
    expect(fbcFrom(null, 'abc', at)).toBe('fb.1.1700000000000.abc');
    expect(fbcFrom(null, null, at)).toBeUndefined();
    for (const c of [190, 102, 100, 200, 299])
      expect(isPermanentGraphError(c)).toBe(true);
    for (const c of [1, 2, 4, 17, 341, 368, undefined])
      expect(isPermanentGraphError(c)).toBe(false);
  });
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;
/** lead sxemasini qayta yaratadigan integratsiya testlari parallel workerda bir-birini buzmasin. */
const LEAD_SCHEMA_TEST_LOCK = 2_304_002;

describeWithPostgres(
  'BE-31: Meta CAPI navbati va yuborish (PostgreSQL)',
  () => {
    let db: DataSource;
    let schemaLock: Client | undefined;
    const SECRET = 'isolated-test-encryption-key-0001';
    const config = (extra: Record<string, string> = {}) =>
      new ConfigService({
        INTEGRATION_CREDENTIAL_SECRET: SECRET,
        LEAD_LANDING_BASE_URL: 'https://land.example.uz/',
        ...extra,
      });
    const capi = (
      responses: Array<CapiResponse | Error>,
      extra: Record<string, string> = {},
    ) => {
      const svc = new CapiService(db, config(extra));
      const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
      svc.sender = async (url, body) => {
        calls.push({ url, body });
        const r = responses.shift() ?? { status: 500, body: null };
        if (r instanceof Error) throw r;
        return r;
      };
      return { svc, calls };
    };
    const ok = { status: 200, body: { events_received: 1, fbtrace_id: 'Ax' } };
    const rows = () =>
      db.getRepository(CapiDelivery).find({ order: { id: 'ASC' } });

    const mkStream = (extra: Partial<Stream> = {}) =>
      db.getRepository(Stream).save({
        code: 'k7Qm2x',
        affiliateId: '77',
        productId: '501',
        salePrice: '262000',
        metaPixelId: '123456789012345',
        capiTokenEnc: encryptSecret('EAAtoken-secret', SECRET),
        ...extra,
      });
    const mkLead = async (stream: Stream, extra: Partial<Lead> = {}) => {
      const click = await db.getRepository(Click).save({
        streamId: stream.id,
        fbp: 'fb.1.1700000000000.555',
        fbclid: 'IwAR-click',
      });
      return db.getRepository(Lead).save(
        db.getRepository(Lead).create({
          source: LeadSource.LANDING,
          streamId: stream.id,
          clickId: click.id,
          affiliateId: stream.affiliateId,
          productId: '501',
          name: 'Aziza',
          phoneE164: '+998901234567',
          regionSoato: '1726',
          districtSoato: '1726266',
          addressLine: 'Turkiston ko‘chasi, 27-uy',
          whereDeliver: CheckoutDeliveryDestination.CENTER,
          salePrice: '262000',
          ip: '203.0.113.7',
          userAgent: 'Mozilla/5.0',
          ...extra,
        }),
      );
    };

    beforeAll(async () => {
      if (!new URL(testDatabaseUrl!).pathname.toLowerCase().includes('test'))
        throw new Error('TEST_DATABASE_URL faqat nomida "test" bor bazaga');
      schemaLock = new Client({ connectionString: testDatabaseUrl });
      await schemaLock.connect();
      await schemaLock.query('SELECT pg_advisory_lock($1)', [
        LEAD_SCHEMA_TEST_LOCK,
      ]);
      db = new DataSource({
        type: 'postgres',
        url: testDatabaseUrl,
        schema: 'lead',
        entities: LEAD_ENTITIES,
        migrations: [
          CreateLeadTables1794787200000,
          CreateOfferContent1794873600000,
          AddLeadReview1794960000000,
          AddLeadQueue1795046400000,
          AddApiLeads1795132800000,
          AddLeadStats1795564800000,
          AddCapiFields1795651200000,
          AddFraudCenter1795824000000,
          SiteOrder1798070400000,
          OperatorStateSince1798416000000,
          Telephony1798675200000,
          LeadUpsell1799366400000,
          OperatorBonus1799452800000,
        ],
        synchronize: false,
        logging: false,
      });
      await db.initialize();
      await db.query('DROP SCHEMA IF EXISTS lead CASCADE');
      await db.query('CREATE SCHEMA lead');
      await db.runMigrations();
    }, 300_000);

    afterAll(async () => {
      if (db?.isInitialized) {
        await db.query('DROP SCHEMA IF EXISTS lead CASCADE');
        await db.destroy();
      }
      await schemaLock?.end();
    });

    beforeEach(async () => {
      await db.query(
        `TRUNCATE ${LEAD_ENTITIES.map((e) => `lead.${db.getMetadata(e).tableName}`).join(', ')}, lead.processed_event RESTART IDENTITY CASCADE`,
      );
    });

    describe('navbat', () => {
      const geo = {
        ok: true,
        regionSoato: '1726',
        regionName: 'T',
        districtSoato: '1726266',
        districtName: 'Y',
        elchiRegionId: '1',
        elchiDistrictId: '10',
      };
      const offer = {
        productId: '501',
        cpaAvailable: true,
        withdrawn: false,
        approvedPrice: 251000,
        maxSalePrice: 276000,
        stock: 10,
      } as CatalogOfferSnapshot;
      const intake = (svc: CapiService) =>
        new LeadIntakeService(
          db,
          db.getRepository(Stream),
          { get: jest.fn(async () => offer) } as never,
          new LeadAddressService(db, { send: jest.fn(() => of(geo)) } as never),
          new ConfigService({
            LEAD_PHONE_OPERATOR_CODES: '90,91,93,94,95,97,98,99',
          }),
          undefined,
          svc,
        );
      const form = (code: string, phone = '+998901234567') =>
        ({
          code,
          name: 'Aziza',
          phone,
          regionSoato: '1726',
          districtSoato: '1726266',
          addressLine: 'Turkiston ko‘chasi, 27-uy',
          whereDeliver: CheckoutDeliveryDestination.ADDRESS,
          consentVersion: '2026-11-16',
        }) as never;

      it('TC1: sotuvchi sahifasidan yangi lid → Lead navbatda; dublikat — qo‘shimcha qator yo‘q', async () => {
        await mkStream();
        const { svc } = capi([]);
        const res = await intake(svc).create({
          lead: form('k7Qm2x'),
          ip: '203.0.113.7',
          userAgent: 'Mozilla/5.0',
        });
        const again = await intake(svc).create({
          lead: form('k7Qm2x'),
          ip: '203.0.113.7',
          userAgent: 'Mozilla/5.0',
        });
        expect(again.duplicate).toBe(true);
        expect((await rows()).map((r) => [r.leadId, r.event])).toEqual([
          [res.leadId, 'LEAD'],
        ]);
      });

      it('piksel yoki token bo‘lmasa, API lidi — navbatga tushmaydi', async () => {
        const { svc } = capi([]);
        const noToken = await mkStream({ code: 'nnnnnn', capiTokenEnc: null });
        await db.transaction((m) =>
          svc.enqueueLead(m, {
            id: '1',
            streamId: noToken.id,
            source: LeadSource.LANDING,
            createdAt: new Date(),
          } as Lead),
        );
        const s = await mkStream();
        await db.transaction((m) =>
          svc.enqueueLead(m, {
            id: '2',
            streamId: s.id,
            source: LeadSource.API,
            createdAt: new Date(),
          } as Lead),
        );
        expect(await rows()).toEqual([]);
      });

      it('TC2: yetkazildi (BE-28 iste’molchisi) → Purchase, summa — mijoz to‘lagan jami', async () => {
        const s = await mkStream();
        const lead = await mkLead(s);
        const { svc } = capi([]);
        const orders = new LeadOrderService(db, svc);
        const at = '2027-01-16T10:00:00.000Z';
        const ev = orderEvent({
          eventId: 'e-del',
          orderId: '9001',
          leadId: lead.id,
          status: LeadOrderStatus.DELIVERED,
          codAmount: 292000,
          occurredAt: at,
        });
        await orders.onOrderStatusChanged(ev);
        await orders.onOrderStatusChanged({
          ...ev,
          eventId: 'e-rem',
          status: LeadOrderStatus.REMITTED,
        });
        const [row] = await rows();
        expect(await rows()).toHaveLength(1);
        expect(row).toMatchObject({ event: 'PURCHASE', value: '292000' });
        expect(row.eventTime).toEqual(new Date(at));
      });
    });

    describe('yuborish', () => {
      const due = async (eventTime = new Date(), code = 'k7Qm2x') => {
        const s = await mkStream({ code });
        const lead = await mkLead(s);
        await db.transaction((m) =>
          new CapiService(db, config()).enqueueLead(m, {
            ...lead,
            createdAt: eventTime,
          }),
        );
        return { s, lead };
      };

      it('TC1/TC4: Graph ga POST; token tanada; event_id = lid ID; fbp va fbclid dan fbc → SENT', async () => {
        const { lead } = await due();
        const { svc, calls } = capi([ok]);
        expect(await svc.sendDue()).toBe(1);
        expect(calls[0].url).toBe(
          'https://graph.facebook.com/v26.0/123456789012345/events',
        );
        expect(calls[0].url).not.toContain('EAAtoken');
        type Ev = { user_data: Record<string, unknown> } & Record<
          string,
          unknown
        >;
        const [event] = calls[0].body.data as Ev[];
        expect(calls[0].body.access_token).toBe('EAAtoken-secret');
        expect(calls[0].body.test_event_code).toBeUndefined();
        expect(event).toMatchObject({
          event_name: 'Lead',
          event_id: lead.id,
          action_source: 'website',
          event_source_url: 'https://land.example.uz/k7Qm2x',
          user_data: {
            client_ip_address: '203.0.113.7',
            client_user_agent: 'Mozilla/5.0',
            fbp: 'fb.1.1700000000000.555',
          },
        });
        expect(event.user_data.fbc).toMatch(/^fb\.1\.\d+\.IwAR-click$/);
        expect(event.user_data.ph).toBeUndefined();
        const [row] = await rows();
        expect(row).toMatchObject({
          attempts: 1,
          responseCode: 200,
          lastError: null,
          nextAttemptAt: null,
        });
        expect(row.deliveredAt).toBeInstanceOf(Date);
        // Qayta ishga tushirilsa yuborilmaydi
        expect(await svc.sendDue()).toBe(0);
      });

      it('telefon sozlama bilan; test kodi va Graph versiyasi sozlamadan', async () => {
        await due();
        const { svc, calls } = capi([ok], {
          LEAD_CAPI_SEND_PHONE: 'on',
          LEAD_CAPI_TEST_EVENT_CODE: 'TEST123',
          META_GRAPH_VERSION: 'v27.0',
        });
        await svc.sendDue();
        expect(calls[0].url).toContain('/v27.0/');
        expect(calls[0].body.test_event_code).toBe('TEST123');
        const data = calls[0].body.data as Array<{
          user_data: { ph?: string[] };
        }>;
        expect(data[0].user_data.ph).toEqual([hashPhone('+998901234567')]);
      });

      it('TC3: token xato (190) → darhol FAILED, sabab jurnalda sotuvchiga ko‘rinadi', async () => {
        await due();
        const { svc } = capi([
          {
            status: 400,
            body: {
              error: { code: 190, message: 'Invalid OAuth access token.' },
            },
          },
        ]);
        await svc.sendDue();
        const [row] = await rows();
        expect(row).toMatchObject({
          attempts: 1,
          responseCode: 400,
          nextAttemptAt: null,
          deliveredAt: null,
          lastError: '190: Invalid OAuth access token.',
        });
        const page = await svc.journal('77', {});
        expect(page.items[0]).toMatchObject({
          status: AffiliatePostbackStatus.FAILED,
          event: AffiliateCapiEvent.LEAD,
          lastError: '190: Invalid OAuth access token.',
          streamCode: 'k7Qm2x',
        });
        expect(await svc.journal('78', {})).toMatchObject({ total: 0 });
      });

      it('vaqtinchalik xato (5xx, tarmoq) → qayta urinish; 5 urinishdan keyin FAILED', async () => {
        await due();
        const { svc } = capi([
          {
            status: 500,
            body: {
              error: { code: 2, message: 'Service temporarily unavailable' },
            },
          },
          new Error('timeout'),
          { status: 503, body: null },
          { status: 500, body: null },
          { status: 500, body: null },
        ]);
        let now = new Date();
        for (let i = 0; i < 5; i++) {
          await svc.sendDue(now);
          const [row] = await rows();
          if (i < 4) {
            expect(row.nextAttemptAt).not.toBeNull();
            now = new Date(row.nextAttemptAt!.getTime() + 1000);
          }
        }
        const [row] = await rows();
        expect(row).toMatchObject({
          attempts: 5,
          nextAttemptAt: null,
          lastError: 'HTTP 500',
        });
      });

      it('7 kundan eski hodisa va ochilmaydigan token → yuborilmay FAILED', async () => {
        await due(new Date(Date.now() - 8 * 24 * 3600 * 1000));
        const { svc, calls } = capi([ok]);
        await svc.sendDue();
        expect(calls).toHaveLength(0);
        expect((await rows())[0]).toMatchObject({
          nextAttemptAt: null,
          lastError: 'Hodisa 7 kundan eski — Meta qabul qilmaydi',
        });
        await db.query('TRUNCATE lead.capi_delivery');
        await due(new Date(), 'bbbbbb');
        await db.query(
          `UPDATE lead.stream SET capi_token_enc = 'buzuq' WHERE code = 'bbbbbb'`,
        );
        await svc.sendDue();
        expect(calls).toHaveLength(0);
        expect((await rows())[0].lastError).toContain(
          'tokenini ochib bo‘lmadi',
        );
      });

      it('Lead 48 soatdan kech — brauzer bilan dedup oynasi o‘tgan, yuborilmaydi', async () => {
        await due(new Date(Date.now() - 49 * 3600 * 1000));
        const { svc, calls } = capi([ok]);
        await svc.sendDue();
        expect(calls).toHaveLength(0);
        expect((await rows())[0]).toMatchObject({
          nextAttemptAt: null,
          lastError: expect.stringContaining('48 soatdan kech'),
        });
      });

      it('Purchase: vaqt — lidning eng erta yetkazilgan vaqti; summa noma’lum bo‘lsa yuborilmaydi', async () => {
        const s = await mkStream({ code: 'pppppp' });
        const lead = await mkLead(s);
        const t1 = new Date(Date.now() - 2 * 3600 * 1000);
        const t2 = new Date(Date.now() - 3600 * 1000);
        await db.query(
          `UPDATE lead.lead SET delivered_at = $2, order_id = 9001 WHERE id = $1`,
          [lead.id, t1],
        );
        const svc0 = new CapiService(db, config());
        await db.transaction((m) => svc0.enqueuePurchase(m, lead, 292000, t2));
        const { svc, calls } = capi([ok]);
        await svc.sendDue();
        const data = calls[0].body.data as Array<{
          event_time: number;
          custom_data: { value: number };
        }>;
        expect(data[0].event_time).toBe(Math.floor(t1.getTime() / 1000));
        expect(data[0].custom_data.value).toBe(292000);

        const other = await mkLead(s, { phoneE164: '+998901112233' });
        await db.transaction((m) =>
          svc0.enqueuePurchase(m, other, Number.NaN, t2),
        );
        const bad = capi([ok]);
        await bad.svc.sendDue();
        expect(bad.calls).toHaveLength(0);
        const row = (await rows()).find((r) => r.leadId === other.id)!;
        expect(row).toMatchObject({
          value: null,
          nextAttemptAt: null,
          lastError: 'Purchase summasi noma’lum — yuborilmadi',
        });
      });

      it('LEAD_CAPI o‘chiq bo‘lsa cron hech narsa yubormaydi', async () => {
        await due();
        const off = capi([ok]);
        await off.svc.run();
        expect(off.calls).toHaveLength(0);
        const on = capi([ok], { LEAD_CAPI: 'on' });
        await on.svc.run();
        expect(on.calls).toHaveLength(1);
      });
    });
  },
);
