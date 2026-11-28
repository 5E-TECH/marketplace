import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  AffiliateCommissionState,
  AffiliateStatsGroupBy,
  CheckoutDeliveryDestination,
  FinanceAffiliateIncomeLine,
  FinanceAffiliateIncomeQuery,
  LeadOrderStatus,
  LeadSource,
  LeadStatus,
  OrderStatusChangedEvent,
} from '@app/common';
import { orderEvent } from '../../finance-service/src/ledger/order-events.samples';
import { LEAD_ENTITIES, Lead, Stream } from './entities';
import { LeadOrderService } from './lead-order.service';
import { LeadQueueService } from './lead-queue.service';
import { tashkentParts } from './lead-schedule';
import { LeadStatsService, STATS_TOTAL_KEY } from './lead-stats.service';
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

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;
/** lead sxemasini qayta yaratadigan integratsiya testlari parallel workerda bir-birini buzmasin (BE-31). */
const LEAD_SCHEMA_TEST_LOCK = 2_304_002;
let schemaLock: Client | undefined;

/**
 * BE-28 — statistika haqiqiy PostgreSQL ustida (faqat `lead` sxemasi). Pul finance-service dan keladi:
 * bu yerda RPC namunasi (BE-22 so‘rovi finance testida tekshirilgan).
 *   TEST_DATABASE_URL=postgresql://.../elchi_lead_test npx jest lead-stats.integration --runInBand
 */
describeWithPostgres('BE-28 statistika (PostgreSQL)', () => {
  let db: DataSource;
  /** affiliateId → ledger qatorlari (finance.affiliate.income namunasi). */
  let ledger: Record<string, FinanceAffiliateIncomeLine[]>;
  const financeSend = jest.fn(
    (_pattern: unknown, q: FinanceAffiliateIncomeQuery) => {
      const lines = ledger[q.affiliateId] ?? [];
      return of({
        lines: q.leadIds
          ? lines.filter(
              (l) => l.kind === 'DELIVERED' && q.leadIds!.includes(l.leadId!),
            )
          : lines.filter((l) => l.day >= q.from! && l.day <= q.to!),
      });
    },
  );
  const stats = () => new LeadStatsService(db, { send: financeSend } as never);
  const orders = () => new LeadOrderService(db);
  let phone = 0;

  const mkStream = async (code: string, affiliateId = '42') => {
    const stream = await db.getRepository(Stream).save({
      code,
      affiliateId,
      productId: '501',
      salePrice: '189000',
    });
    await db.query(
      `UPDATE lead.stream SET created_at = '2026-01-01T00:00:00Z' WHERE id = $1`,
      [stream.id],
    );
    return stream;
  };
  const mkLead = async (
    stream: Stream,
    createdAt: string,
    extra: Partial<Lead> = {},
  ) => {
    const lead = await db.getRepository(Lead).save(
      db.getRepository(Lead).create({
        source: LeadSource.LANDING,
        streamId: stream.id,
        affiliateId: stream.affiliateId,
        productId: '501',
        name: 'Aziza Karimova',
        phoneE164: `+99890${String(1234567 + phone++).padStart(7, '0')}`,
        regionSoato: '1726',
        districtSoato: '1726266',
        addressLine: 'Turkiston ko‘chasi, 27-uy',
        whereDeliver: CheckoutDeliveryDestination.CENTER,
        salePrice: '189000',
        ...extra,
      }),
    );
    await db.query(`UPDATE lead.lead SET created_at = $2 WHERE id = $1`, [
      lead.id,
      createdAt,
    ]);
    return lead;
  };
  const mkClicks = (stream: Stream, n: number, at: string, sub1?: string) =>
    db.query(
      `INSERT INTO lead.click (stream_id, sub1, created_at)
       SELECT $1, $2, $3 FROM generate_series(1, $4)`,
      [stream.id, sub1 ?? null, at, n],
    );
  const confirm = (lead: Lead, at: string, operatorId = '41') =>
    db.query(
      `UPDATE lead.lead SET status = 'CONFIRMED', confirmed_at = $2, confirmed_by = $3 WHERE id = $1`,
      [lead.id, at, operatorId],
    );
  let seq = 0;
  const event = (
    lead: Lead,
    status: LeadOrderStatus,
    at: string,
    over: Partial<OrderStatusChangedEvent> = {},
    item = {},
  ) =>
    orderEvent(
      {
        eventId: `ev-${++seq}`,
        orderId: String(7000 + Number(lead.id)),
        leadId: lead.id,
        streamId: lead.streamId,
        affiliateId: lead.affiliateId,
        status,
        occurredAt: at,
        ...over,
      },
      item,
    );
  const reload = (id: string) => db.getRepository(Lead).findOneByOrFail({ id });
  const income = (
    lead: Lead,
    day: string,
    amount: number,
    over: Partial<FinanceAffiliateIncomeLine> = {},
  ): FinanceAffiliateIncomeLine => ({
    leadId: lead.id,
    orderId: String(7000 + Number(lead.id)),
    kind: 'DELIVERED',
    day,
    column: 'HOLD',
    amount,
    state: 'HOLD',
    ...over,
  });

  beforeAll(async () => {
    if (!new URL(testDatabaseUrl!).pathname.toLowerCase().includes('test'))
      throw new Error(
        'TEST_DATABASE_URL faqat nomida "test" bor alohida bazaga ishora qilishi kerak',
      );
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
    // «Bugun» — test sanalari kelajakda qolmasligi uchun (bo‘sh kunlar bugungacha to‘ldiriladi)
    jest
      .spyOn(LeadStatsService.prototype as never, 'todayTashkent' as never)
      .mockReturnValue('2026-12-31' as never);
    schemaLock = new Client({ connectionString: testDatabaseUrl });
    await schemaLock.connect();
    await schemaLock.query('SELECT pg_advisory_lock($1)', [
      LEAD_SCHEMA_TEST_LOCK,
    ]);
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
    await schemaLock?.end(); // sessiya yopilsa qulf bo‘shaydi
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE ${LEAD_ENTITIES.map((e) => `lead.${db.getMetadata(e).tableName}`).join(', ')}, lead.processed_event RESTART IDENTITY CASCADE`,
    );
    ledger = {};
    financeSend.mockClear();
  });

  describe('sotuvchi statistikasi (SOT-4)', () => {
    // 2026-12-01 10:00 Toshkent = 05:00 UTC
    const D1 = '2026-12-01T05:00:00.000Z';

    it('TC1: 10 lid, 5 tasdiq, 4 yetkazildi → statistika aynan shu; har son o‘z kunida', async () => {
      const s = await mkStream('k7Qm2x');
      await mkClicks(s, 25, D1, 'fb');
      const leads: Lead[] = [];
      for (let i = 0; i < 10; i++) leads.push(await mkLead(s, D1));
      for (const l of leads.slice(0, 5))
        await confirm(l, '2026-12-02T05:00:00.000Z');
      for (const l of leads.slice(0, 4))
        await orders().onOrderStatusChanged(
          event(l, LeadOrderStatus.DELIVERED, '2026-12-03T05:00:00.000Z'),
        );
      await orders().onOrderStatusChanged(
        event(leads[4], LeadOrderStatus.REFUSED, '2026-12-04T05:00:00.000Z'),
      );
      ledger['42'] = leads
        .slice(0, 4)
        .map((l) => income(l, '2026-12-03', 65000));

      const res = await stats().affiliateStats({
        affiliateId: '42',
        query: { from: '2026-12-01', to: '2026-12-05' },
      });
      const z = {
        clicks: 0,
        leads: 0,
        validLeads: 0,
        confirmed: 0,
        delivered: 0,
        refused: 0,
        incomeHold: 0,
        incomeAvailable: 0,
      };
      expect(res.rows).toEqual([
        { ...z, key: '2026-12-01', clicks: 25, leads: 10, validLeads: 10 },
        { ...z, key: '2026-12-02', confirmed: 5 },
        { ...z, key: '2026-12-03', delivered: 4, incomeHold: 260000 },
        { ...z, key: '2026-12-04', refused: 1 },
        { ...z, key: '2026-12-05' },
      ]);
      expect(res.totals).toEqual({
        key: STATS_TOTAL_KEY,
        clicks: 25,
        leads: 10,
        validLeads: 10,
        confirmed: 5,
        delivered: 4,
        refused: 1,
        incomeHold: 260000,
        incomeAvailable: 0,
      });
      expect(financeSend).toHaveBeenCalledWith(
        { cmd: 'finance.affiliate.income' },
        { affiliateId: '42', from: '2026-12-01', to: '2026-12-05' },
      );
    });

    it('yaroqli: yaroqsiz, dublikat va tekshiruvdagi ariza kirmaydi; kun Toshkent bo‘yicha', async () => {
      const s = await mkStream('k7Qm2x');
      await mkLead(s, D1);
      await mkLead(s, D1, { status: LeadStatus.INVALID });
      await mkLead(s, D1, { status: LeadStatus.MERGED });
      await mkLead(s, D1, { reviewReason: 'IP_RATE' as never });
      await mkLead(s, '2026-12-01T19:30:00.000Z'); // 2-dekabr 00:30 Toshkent
      const { rows } = await stats().affiliateStats({
        affiliateId: '42',
        query: { from: '2026-12-01', to: '2026-12-02' },
      });
      expect(rows.map((r) => [r.key, r.leads, r.validLeads])).toEqual([
        ['2026-12-01', 4, 1],
        ['2026-12-02', 1, 1],
      ]);
    });

    it('sahifa va sub1 kesimi; sub yo‘q — bo‘sh kalit, oxirida; daromad lid sahifasi/sub iga', async () => {
      const a = await mkStream('aaa111');
      const b = await mkStream('bbb222');
      await mkClicks(a, 3, D1, 'fb');
      await mkClicks(b, 2, D1);
      const la = await mkLead(a, D1, { sub1: 'fb' });
      const lb = await mkLead(b, D1);
      await confirm(la, D1);
      await confirm(lb, D1);
      ledger['42'] = [
        income(la, '2026-12-01', 65000, {
          column: 'AVAILABLE',
          state: 'AVAILABLE',
        }),
        income(lb, '2026-12-01', 86250),
      ];
      const by = async (groupBy: AffiliateStatsGroupBy) =>
        (
          await stats().affiliateStats({
            affiliateId: '42',
            query: { from: '2026-12-01', to: '2026-12-01', groupBy },
          })
        ).rows.map((r) => [
          r.key,
          r.clicks,
          r.leads,
          r.confirmed,
          r.incomeHold,
          r.incomeAvailable,
        ]);
      expect(await by(AffiliateStatsGroupBy.STREAM)).toEqual([
        ['aaa111', 3, 1, 1, 0, 65000],
        ['bbb222', 2, 1, 1, 86250, 0],
      ]);
      expect(await by(AffiliateStatsGroupBy.SUB1)).toEqual([
        ['fb', 3, 1, 1, 0, 65000],
        ['', 2, 1, 1, 86250, 0],
      ]);
      // streamId filtri hamma ustunga, daromadga ham
      const only = await stats().affiliateStats({
        affiliateId: '42',
        query: { from: '2026-12-01', to: '2026-12-01', streamId: b.id },
      });
      expect(only.totals).toMatchObject({
        clicks: 2,
        leads: 1,
        incomeHold: 86250,
        incomeAvailable: 0,
      });
    });

    it('qaytarish: asl daromad yetkazilgan kunda, minus qaytarilgan kunda; davr yig‘indisi 0', async () => {
      const s = await mkStream('k7Qm2x');
      const l = await mkLead(s, D1);
      ledger['42'] = [
        income(l, '2026-12-03', 65000, {
          column: 'AVAILABLE',
          state: 'REVERSED',
        }),
        income(l, '2026-12-05', -65000, {
          kind: 'REVERSAL',
          column: 'AVAILABLE',
          state: 'REVERSED',
        }),
      ];
      const res = await stats().affiliateStats({
        affiliateId: '42',
        query: { from: '2026-12-03', to: '2026-12-05' },
      });
      expect(res.rows.map((r) => [r.key, r.incomeAvailable])).toEqual([
        ['2026-12-03', 65000],
        ['2026-12-04', 0],
        ['2026-12-05', -65000],
      ]);
      expect(res.totals.incomeAvailable).toBe(0);
    });

    it('boshqa sotuvchining ma’lumoti kirmaydi; boshqa sotuvchining sahifasi bilan so‘rasa — hammasi 0', async () => {
      const mine = await mkStream('mine01');
      const other = await mkStream('other1', '43');
      await mkClicks(other, 9, D1);
      const ol = await mkLead(other, D1);
      await confirm(ol, D1);
      await mkLead(mine, D1);
      ledger['43'] = [income(ol, '2026-12-01', 65000)];
      const res = await stats().affiliateStats({
        affiliateId: '42',
        query: { from: '2026-12-01', to: '2026-12-01' },
      });
      expect(res.totals).toMatchObject({
        clicks: 0,
        leads: 1,
        confirmed: 0,
        incomeHold: 0,
      });
      // Finance A sotuvchining hisobidan qaytargan qator boshqa sotuvchining lidiga tegishli bo‘lsa ham tashlanadi
      ledger['42'] = [income(ol, '2026-12-01', 65000)];
      const foreign = await stats().affiliateStats({
        affiliateId: '42',
        query: { from: '2026-12-01', to: '2026-12-01', streamId: other.id },
      });
      expect(foreign.totals).toMatchObject({
        clicks: 0,
        leads: 0,
        confirmed: 0,
        incomeHold: 0,
      });
    });

    it('juda keng davr: bo‘sh kunlar faqat birinchi sahifa ochilgan kundan bugungacha (javob hajmi cheklangan)', async () => {
      const st = await mkStream('k7Qm2x');
      await mkLead(st, D1);
      const { rows, totals } = await stats().affiliateStats({
        affiliateId: '42',
        query: { from: '0001-01-01', to: '9999-12-31' },
      });
      expect(rows).toHaveLength(365);
      expect(rows[0].key).toBe('2026-01-01');
      expect(rows.at(-1)!.key).toBe('2026-12-31');
      expect(totals.leads).toBe(1);
      // Sahifasi yo‘q sotuvchi — bo‘sh kunlar yo‘q
      expect(
        (
          await stats().affiliateStats({
            affiliateId: '99',
            query: { from: '2026-12-01', to: '2026-12-05' },
          })
        ).rows,
      ).toEqual([]);
    });

    it('noto‘g‘ri so‘rov — 400 (to‘liq ISO vaqt, from > to, noto‘g‘ri sana, sotuvchi ID)', async () => {
      for (const [affiliateId, from, to] of [
        ['42', '2026-12-01T00:00:00Z', '2026-12-02'],
        ['42', '2026-12-03', '2026-12-02'],
        ['42', '2026-02-30', '2026-03-01'],
        ['abc', '2026-12-01', '2026-12-02'],
      ])
        await expect(
          stats().affiliateStats({ affiliateId, query: { from, to } }),
        ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('sotuvchi lidlari — CSV manbasi (TC2)', () => {
    const DTO_KEYS = [
      'commission',
      'commissionState',
      'createdAt',
      'id',
      'orderStatus',
      'phoneLast4',
      'status',
      'streamCode',
      'sub1',
      'sub2',
      'sub3',
      'sub4',
      'sub5',
    ];

    it('TC2: ****4567, ism, manzil, to‘liq raqam va variant yo‘q; haq va haq holati', async () => {
      const s = await mkStream('k7Qm2x');
      const at = (m: number) =>
        new Date(Date.UTC(2027, 0, 14, 4, m)).toISOString();
      const fresh = await mkLead(s, at(1), {
        phoneE164: '+998901234567',
        variant: 's1' as never,
        sub1: 'kampaniya-1',
      });
      const rejected = await mkLead(s, at(2), {
        status: LeadStatus.REJECTED,
        rejectReason: 'TOO_EXPENSIVE' as never,
      });
      const pending = await mkLead(s, at(3));
      const held = await mkLead(s, at(4));
      const refused = await mkLead(s, at(5));
      const review = await mkLead(s, at(6), {
        reviewReason: 'IP_RATE' as never,
      });
      for (const l of [pending, held, refused]) await confirm(l, at(10));
      await orders().onOrderStatusChanged(
        event(
          pending,
          LeadOrderStatus.IN_TRANSIT,
          at(20),
          {},
          {
            approvedPrice: 251000,
            salePrice: 276000,
          },
        ),
      );
      await orders().onOrderStatusChanged(
        event(held, LeadOrderStatus.DELIVERED, at(21)),
      );
      await orders().onOrderStatusChanged(
        event(refused, LeadOrderStatus.REFUSED, at(22)),
      );
      ledger['42'] = [income(held, '2027-01-14', 65000)];

      const page = await stats().affiliateLeads({
        affiliateId: '42',
        query: { from: '2027-01-14', to: '2027-01-14' },
      });
      expect(page).toMatchObject({
        total: 6,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      const byId = Object.fromEntries(page.items.map((i) => [i.id, i]));
      for (const item of page.items)
        expect(Object.keys(item).sort()).toEqual(DTO_KEYS);
      const json = JSON.stringify(page);
      for (const hidden of ['Aziza', 'Turkiston', '1726', '+99890', '"s1"'])
        expect(json).not.toContain(hidden);

      expect(byId[fresh.id]).toMatchObject({
        streamCode: 'k7Qm2x',
        sub1: 'kampaniya-1',
        phoneLast4: '****4567',
        status: LeadStatus.NEW,
        orderStatus: null,
        commission: null,
        commissionState: null,
      });
      expect(byId[rejected.id]).toMatchObject({
        commission: null,
        commissionState: AffiliateCommissionState.NONE,
      });
      expect(byId[pending.id]).toMatchObject({
        orderStatus: LeadOrderStatus.IN_TRANSIT,
        commission: 86250,
        commissionState: AffiliateCommissionState.PENDING,
      });
      expect(byId[held.id]).toMatchObject({
        orderStatus: LeadOrderStatus.DELIVERED,
        commission: 65000,
        commissionState: AffiliateCommissionState.HOLD,
      });
      expect(byId[refused.id]).toMatchObject({
        orderStatus: LeadOrderStatus.REFUSED,
        commission: null,
        commissionState: AffiliateCommissionState.NONE,
      });
      expect(byId[review.id].phoneLast4).toBe('****');
      // Yangilari birinchi; finance faqat tasdiqlanganlar bo‘yicha so‘raladi
      expect(page.items[0].id).toBe(review.id);
      expect(financeSend).toHaveBeenLastCalledWith(
        { cmd: 'finance.affiliate.income' },
        {
          affiliateId: '42',
          leadIds: expect.arrayContaining([pending.id, held.id, refused.id]),
        },
      );
      expect(
        (financeSend.mock.calls.at(-1)![1] as FinanceAffiliateIncomeQuery)
          .leadIds,
      ).toHaveLength(3);
    });

    it('sahifalash, holat va sahifa filtri; boshqa sotuvchining lidi yo‘q', async () => {
      const s = await mkStream('k7Qm2x');
      const other = await mkStream('other1', '43');
      for (let i = 0; i < 5; i++)
        await mkLead(s, new Date(Date.UTC(2027, 0, 14, 4, i)).toISOString());
      await mkLead(other, '2027-01-14T04:30:00.000Z');
      const p2 = await stats().affiliateLeads({
        affiliateId: '42',
        query: { from: '2027-01-14', to: '2027-01-14', page: 2, limit: 2 },
      });
      expect(p2).toMatchObject({ total: 5, page: 2, limit: 2, totalPages: 3 });
      expect(p2.items).toHaveLength(2);
      const none = await stats().affiliateLeads({
        affiliateId: '42',
        query: {
          from: '2027-01-14',
          to: '2027-01-14',
          status: LeadStatus.CONFIRMED,
        },
      });
      expect(none).toMatchObject({ total: 0, items: [] });
      const foreign = await stats().affiliateLeads({
        affiliateId: '42',
        query: { from: '2027-01-14', to: '2027-01-14', streamId: other.id },
      });
      expect(foreign.total).toBe(0);
      expect(financeSend).not.toHaveBeenCalled();
      await expect(
        stats().affiliateLeads({
          affiliateId: '42',
          query: {
            from: '2027-01-14',
            to: '2027-01-14',
            page: 1e17,
            limit: 100,
          },
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('operator statistikasi (OPR-7)', () => {
    const ago = (min: number) => new Date(Date.now() - min * 60_000);
    const today = () => {
      const p = tashkentParts(new Date());
      return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    };
    const yesterday = () => {
      const p = tashkentParts(new Date(Date.now() - 86_400_000));
      return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    };
    const attempt = (
      lead: Lead,
      operatorId: string,
      outcome: string,
      at: Date,
    ) =>
      db.query(
        `INSERT INTO lead.lead_attempt (lead_id, operator_id, outcome, created_at) VALUES ($1, $2, $3, $4)`,
        [lead.id, operatorId, outcome, at],
      );
    const opStats = (operatorId = '41') =>
      stats().operatorStats({
        operatorId,
        query: { from: yesterday(), to: today() },
      });

    it('TC3: urinish, tasdiq %, sotilish %, birinchi qo‘ng‘iroq; yangi natija darhol ko‘rinadi', async () => {
      const s = await mkStream('k7Qm2x');
      const a = await mkLead(s, ago(10).toISOString());
      const b = await mkLead(s, ago(20).toISOString());
      const c = await mkLead(s, ago(30).toISOString(), {
        status: LeadStatus.INVALID,
      });
      await attempt(a, '41', 'NO_ANSWER', ago(8)); // birinchi — 2 daqiqa
      await attempt(a, '41', 'CONFIRMED', ago(2));
      await confirm(a, ago(2).toISOString());
      await attempt(b, '40', 'NO_ANSWER', ago(15)); // birinchisi boshqa operatorniki
      await attempt(b, '41', 'REJECTED', ago(5));
      await attempt(c, '41', 'INVALID', ago(24)); // birinchi — 6 daqiqa
      expect(await opStats()).toEqual({
        attempts: 4,
        confirmed: 1,
        approveRate: 50, // 1 / 2 yaroqli (a, b)
        saleRate: null, // hali yetkazilmagan
        firstCallMedianMinutes: 4, // median(2, 6)
        upsellRate: 0, // BE-45: 0 / 1 tasdiq
        upsellBonus: 0,
        upsellBonusCount: 0,
      });
      // Yangi natija — keyingi so‘rovda (kesh yo‘q)
      await attempt(b, '41', 'NO_ANSWER', new Date());
      expect((await opStats()).attempts).toBe(5);
      await orders().onOrderStatusChanged(
        event(a, LeadOrderStatus.DELIVERED, new Date().toISOString()),
      );
      expect((await opStats()).saleRate).toBe(100);
      // Boshqa operator
      expect(await opStats('40')).toEqual({
        attempts: 1,
        confirmed: 0,
        approveRate: 0,
        saleRate: null,
        firstCallMedianMinutes: 5,
        upsellRate: null,
        upsellBonus: 0,
        upsellBonusCount: 0,
      });
    });

    it('ish yo‘q — foizlar va median bo‘sh', async () => {
      expect(await opStats('99')).toEqual({
        attempts: 0,
        confirmed: 0,
        approveRate: null,
        saleRate: null,
        firstCallMedianMinutes: null,
        upsellRate: null,
        upsellBonus: 0,
        upsellBonusCount: 0,
      });
    });
  });

  describe('order.status.changed → lid (BE-18 hodisasi)', () => {
    it('takror hodisa bir marta; eskirgan hodisa oxirgi holatni bosmaydi; yetkazildi kuni saqlanadi', async () => {
      const s = await mkStream('k7Qm2x');
      const l = await mkLead(s, '2026-12-01T05:00:00.000Z');
      await confirm(l, '2026-12-01T06:00:00.000Z');
      const delivered = event(
        l,
        LeadOrderStatus.DELIVERED,
        '2026-12-03T05:00:00.000Z',
      );
      await orders().onOrderStatusChanged(delivered);
      await orders().onOrderStatusChanged(delivered);
      await orders().onOrderStatusChanged(
        event(l, LeadOrderStatus.IN_TRANSIT, '2026-12-02T05:00:00.000Z'),
      );
      const row = await reload(l.id);
      expect(row).toMatchObject({
        orderId: String(7000 + Number(l.id)),
        orderStatus: LeadOrderStatus.DELIVERED,
        expectedCommission: '65000',
      });
      expect(row.deliveredAt).toEqual(new Date('2026-12-03T05:00:00.000Z'));
      expect(row.refusedAt).toBeNull();
      expect(
        Number(
          (await db.query(`SELECT count(*) AS n FROM lead.processed_event`))[0]
            .n,
        ),
      ).toBe(2);
    });

    it('DELIVERED kelmay REMITTED kelsa ham yetkazildi kuni yoziladi; REFUSED → rad kuni', async () => {
      const s = await mkStream('k7Qm2x');
      const a = await mkLead(s, '2026-12-01T05:00:00.000Z');
      const b = await mkLead(s, '2026-12-01T05:00:00.000Z');
      await orders().onOrderStatusChanged(
        event(a, LeadOrderStatus.REMITTED, '2026-12-05T05:00:00.000Z'),
      );
      await orders().onOrderStatusChanged(
        event(b, LeadOrderStatus.RETURNING, '2026-12-06T05:00:00.000Z'),
      );
      expect((await reload(a.id)).deliveredAt).toEqual(
        new Date('2026-12-05T05:00:00.000Z'),
      );
      expect((await reload(b.id)).refusedAt).toEqual(
        new Date('2026-12-06T05:00:00.000Z'),
      );
    });

    it('tartibsiz hodisa: eng erta yetkazildi va rad vaqti olinadi (ledger kuni bilan bir xil)', async () => {
      const s1 = await mkStream('k7Qm2x');
      const a = await mkLead(s1, '2026-12-01T05:00:00.000Z');
      const b = await mkLead(s1, '2026-12-01T05:00:00.000Z');
      await orders().onOrderStatusChanged(
        event(a, LeadOrderStatus.REMITTED, '2026-12-05T05:00:00.000Z'),
      );
      await orders().onOrderStatusChanged(
        event(a, LeadOrderStatus.DELIVERED, '2026-12-03T05:00:00.000Z'),
      );
      await orders().onOrderStatusChanged(
        event(b, LeadOrderStatus.RETURNING, '2026-12-06T05:00:00.000Z'),
      );
      await orders().onOrderStatusChanged(
        event(b, LeadOrderStatus.REFUSED, '2026-12-04T05:00:00.000Z'),
      );
      expect(await reload(a.id)).toMatchObject({
        orderStatus: LeadOrderStatus.REMITTED,
        deliveredAt: new Date('2026-12-03T05:00:00.000Z'),
      });
      expect(await reload(b.id)).toMatchObject({
        orderStatus: LeadOrderStatus.RETURNING,
        refusedAt: new Date('2026-12-04T05:00:00.000Z'),
      });
    });

    it('asosiy sayt (lid yo‘q), noto‘g‘ri hodisa va boshqa buyurtma e’tiborsiz; xato tashlanmaydi', async () => {
      const s = await mkStream('k7Qm2x');
      const l = await mkLead(s, '2026-12-01T05:00:00.000Z');
      await orders().onOrderStatusChanged(
        event(l, LeadOrderStatus.DELIVERED, '2026-12-03T05:00:00.000Z', {
          leadId: null,
          source: 'SITE',
        }),
      );
      await orders().onOrderStatusChanged(
        event(l, LeadOrderStatus.DELIVERED, '2026-12-03T05:00:00.000Z', {
          leadId: 'abc',
        }),
      );
      await orders().onOrderStatusChanged(
        event(l, 'NOPE' as never, '2026-12-03T05:00:00.000Z'),
      );
      await orders().onOrderStatusChanged(
        event(l, LeadOrderStatus.CONFIRMED, '2026-12-02T05:00:00.000Z', {
          orderId: '1',
        }),
      );
      await orders().onOrderStatusChanged(
        event(l, LeadOrderStatus.DELIVERED, '2026-12-03T05:00:00.000Z', {
          orderId: '2',
        }),
      );
      expect(await reload(l.id)).toMatchObject({
        orderId: '1',
        orderStatus: LeadOrderStatus.CONFIRMED,
        deliveredAt: null,
      });
    });

    it('eskirgan order.create-failed (qayta tasdiqdan oldingi yoki buyurtmasi bor lid) e’tiborsiz', async () => {
      const s1 = await mkStream('k7Qm2x');
      const again = await mkLead(s1, '2026-12-01T05:00:00.000Z');
      await confirm(again, '2026-12-02T05:00:00.000Z');
      const ordered = await mkLead(s1, '2026-12-01T05:00:00.000Z');
      await confirm(ordered, '2026-12-01T06:00:00.000Z');
      await orders().onOrderStatusChanged(
        event(ordered, LeadOrderStatus.CONFIRMED, '2026-12-01T06:01:00.000Z'),
      );
      const q = new LeadQueueService(db, {} as never);
      await q.onOrderCreateFailed({
        eventId: 'cf-old',
        leadId: again.id,
        reason: 'OUT_OF_STOCK' as never,
        at: '2026-12-01T06:00:00.000Z', // qayta tasdiqdan (12-02) oldin
      });
      await q.onOrderCreateFailed({
        eventId: 'cf-ord',
        leadId: ordered.id,
        reason: 'OUT_OF_STOCK' as never,
        at: '2026-12-01T07:00:00.000Z',
      });
      for (const l of [again, ordered])
        expect(await reload(l.id)).toMatchObject({
          status: LeadStatus.CONFIRMED,
          confirmedBy: '41',
        });
    });

    it('order.create-failed tasdiqni bekor qiladi: «Tasdiqlangan» ga kirmaydi', async () => {
      const s = await mkStream('k7Qm2x');
      const l = await mkLead(s, '2026-12-01T05:00:00.000Z');
      await confirm(l, '2026-12-01T06:00:00.000Z');
      await new LeadQueueService(db, {} as never).onOrderCreateFailed({
        eventId: 'cf-1',
        leadId: l.id,
        reason: 'OUT_OF_STOCK' as never,
        at: '2026-12-01T06:05:00.000Z', // tasdiqdan keyin
      });
      expect(await reload(l.id)).toMatchObject({
        status: LeadStatus.CALLBACK,
        confirmedAt: null,
        confirmedBy: null,
      });
      const { totals } = await stats().affiliateStats({
        affiliateId: '42',
        query: { from: '2026-12-01', to: '2026-12-01' },
      });
      expect(totals.confirmed).toBe(0);
    });
  });

  describe('migratsiya', () => {
    it('mavjud tasdiqlangan lidlarga tasdiq vaqti va operatori oxirgi CONFIRMED urinishidan yoziladi; down/up', async () => {
      await db.undoLastMigration(); // BE-45 (upsell bonusi)
      await db.undoLastMigration(); // BE-45 (upsell)
      await db.undoLastMigration(); // BE-15 (telefoniya)
      await db.undoLastMigration(); // BE-25 (operator holati vaqti)
      await db.undoLastMigration(); // BE-34 (sayt buyurtmasi)
      await db.undoLastMigration(); // BE-35 (firibgarlik markazi)
      await db.undoLastMigration(); // BE-31 capi maydonlari
      await db.undoLastMigration(); // BE-28 statistika ustunlari
      const [{ id }] = await db.query(
        `INSERT INTO lead.stream (code, affiliate_id, product_id, sale_price) VALUES ('mig001', 42, 501, 189000) RETURNING id`,
      );
      const [{ id: leadId }] = await db.query(
        `INSERT INTO lead.lead (source, stream_id, affiliate_id, product_id, status, name, phone_e164,
                                region_soato, district_soato, address_line, where_deliver, sale_price)
         VALUES ('LANDING', $1, 42, 501, 'CONFIRMED', 'A', '+998901112233', '1726', '1726266', 'x', 'CENTER', 189000)
         RETURNING id`,
        [id],
      );
      await db.query(
        `INSERT INTO lead.lead_attempt (lead_id, operator_id, outcome, created_at) VALUES
           ($1, 40, 'CONFIRMED', '2026-12-01T05:00:00Z'), ($1, 41, 'CONFIRMED', '2026-12-02T05:00:00Z'),
           ($1, 41, 'NO_ANSWER', '2026-12-03T05:00:00Z')`,
        [leadId],
      );
      await db.runMigrations();
      const [row] = await db.query(
        `SELECT confirmed_by::text AS "by", confirmed_at AS "at" FROM lead.lead WHERE id = $1`,
        [leadId],
      );
      expect(row).toEqual({
        by: '41',
        at: new Date('2026-12-02T05:00:00Z'),
      });
    });
  });
});
