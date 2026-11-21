import { BadRequestException } from '@nestjs/common';
import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  CheckoutDeliveryDestination,
  LeadSource,
  LeadStatus,
  PlatformMetricsGroupBy,
} from '@app/common';
import { LEAD_ENTITIES, Lead, Stream } from './entities';
import { LeadStatsService } from './lead-stats.service';
import { CreateLeadTables1794787200000 } from './migrations/1794787200000-create-lead-tables';
import { CreateOfferContent1794873600000 } from './migrations/1794873600000-create-offer-content';
import { AddLeadReview1794960000000 } from './migrations/1794960000000-add-lead-review';
import { AddLeadQueue1795046400000 } from './migrations/1795046400000-add-lead-queue';
import { AddApiLeads1795132800000 } from './migrations/1795132800000-add-api-leads';
import { AddLeadStats1795564800000 } from './migrations/1795564800000-add-lead-stats';
import { AddCapiFields1795651200000 } from './migrations/1795651200000-add-capi-fields';
import { AddFraudCenter1795824000000 } from './migrations/1795824000000-add-fraud-center';
import { PlatformStatsService } from './platform-stats.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;
const LEAD_SCHEMA_TEST_LOCK = 2_304_002;
let schemaLock: Client | undefined;

/**
 * BE-46 — admin ko‘rsatkichlari, lid qismi (TZ 9-bo‘lim), haqiqiy PostgreSQL. Ma’lumot (Toshkent, 2026-12-01/02):
 * - sotuvchi 42: 20 klik, 10 lid — 1 yaroqsiz, 2 dublikat, 1 «Aloqa bo‘lmadi», 3 tasdiqlangan (L1, L2 — operator 41;
 *   L3 — 51), L1 va L3 yetkazildi, L2 rad (02.12);
 * - sotuvchi 43 (boshqa offer): 5 klik, 2 lid, M1 tasdiqlangan (51) va yetkazildi;
 * - urinishlar: L1 — 41 (10 daq), 51 (30 daq); L2 — 41 (20 daq); L3 — 51 (40 daq); yaroqsiz — 41 (5 daq).
 */
describeWithPostgres(
  'BE-46 platforma ko‘rsatkichlari — lid qismi (PostgreSQL)',
  () => {
    let db: DataSource;
    const svc = () => new PlatformStatsService(db);
    const be28 = () =>
      new LeadStatsService(db, {
        send: jest.fn(() => of({ lines: [] })),
      } as never);
    let phone = 0;
    const FROM = '2026-12-01';
    const TO = '2026-12-02';
    const CREATED = '2026-12-01T05:00:00.000Z'; // 10:00 Toshkent
    const min = (m: number, base = CREATED) =>
      new Date(Date.parse(base) + m * 60_000).toISOString();

    const mkStream = async (
      code: string,
      affiliateId: string,
      productId: string,
    ) =>
      db.getRepository(Stream).save({
        code,
        affiliateId,
        productId,
        salePrice: '189000',
      });
    const mkLead = async (
      stream: Stream,
      createdAt: string,
      status: LeadStatus = LeadStatus.NEW,
    ) => {
      const lead = await db.getRepository(Lead).save(
        db.getRepository(Lead).create({
          source: LeadSource.LANDING,
          streamId: stream.id,
          affiliateId: stream.affiliateId,
          productId: stream.productId,
          name: 'Aziza Karimova',
          phoneE164: `+99890${String(2234567 + phone++).padStart(7, '0')}`,
          regionSoato: '1726',
          districtSoato: '1726266',
          addressLine: 'Turkiston ko‘chasi, 27-uy',
          whereDeliver: CheckoutDeliveryDestination.CENTER,
          salePrice: '189000',
          status,
        }),
      );
      await db.query(`UPDATE lead.lead SET created_at = $2 WHERE id = $1`, [
        lead.id,
        createdAt,
      ]);
      return lead;
    };
    const attempt = (lead: Lead, operatorId: string, at: string) =>
      db.query(
        `INSERT INTO lead.lead_attempt (lead_id, operator_id, outcome, created_at) VALUES ($1, $2, 'NO_ANSWER', $3)`,
        [lead.id, operatorId, at],
      );
    const confirm = (lead: Lead, operatorId: string) =>
      db.query(
        `UPDATE lead.lead SET status = 'CONFIRMED', confirmed_at = '2026-12-01T07:00:00Z', confirmed_by = $2
        WHERE id = $1`,
        [lead.id, operatorId],
      );
    const deliver = (lead: Lead) =>
      db.query(
        `UPDATE lead.lead SET delivered_at = '2026-12-02T09:00:00Z', expected_commission = 65000 WHERE id = $1`,
        [lead.id],
      );
    const refuse = (lead: Lead) =>
      db.query(
        `UPDATE lead.lead SET refused_at = '2026-12-02T09:00:00Z' WHERE id = $1`,
        [lead.id],
      );
    const clicks = (stream: Stream, n: number) =>
      db.query(
        `INSERT INTO lead.click (stream_id, created_at) SELECT $1, $2 FROM generate_series(1, $3)`,
        [stream.id, '2026-12-01T04:00:00Z', n],
      );

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
        ],
        synchronize: false,
        logging: false,
      });
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

      const s42 = await mkStream('p42', '42', '501');
      const s43 = await mkStream('p43', '43', '502');
      await db.query(
        `UPDATE lead.stream SET created_at = '2026-11-01T00:00:00Z'`,
      );
      await clicks(s42, 20);
      await clicks(s43, 5);
      const l1 = await mkLead(s42, CREATED);
      const l2 = await mkLead(s42, CREATED);
      const l3 = await mkLead(s42, CREATED);
      const invalid = await mkLead(s42, CREATED, LeadStatus.INVALID);
      await mkLead(s42, CREATED, LeadStatus.MERGED);
      await mkLead(s42, CREATED, LeadStatus.MERGED);
      await mkLead(s42, CREATED, LeadStatus.NO_CONTACT);
      for (let i = 0; i < 3; i++) await mkLead(s42, CREATED);
      const m1 = await mkLead(s43, '2026-12-01T06:00:00.000Z');
      await mkLead(s43, '2026-12-01T06:00:00.000Z');

      await attempt(l1, '41', min(10));
      await attempt(l1, '51', min(30));
      await attempt(l2, '41', min(20));
      await attempt(l3, '51', min(40));
      await attempt(invalid, '41', min(5));
      await confirm(l1, '41');
      await confirm(l2, '41');
      await confirm(l3, '51');
      await confirm(m1, '51');
      await deliver(l1);
      await deliver(l3);
      await deliver(m1);
      await refuse(l2);
    }, 300_000);

    afterAll(async () => {
      if (db?.isInitialized) {
        await db.query('DROP SCHEMA IF EXISTS lead CASCADE');
        await db.destroy();
      }
      await schemaLock?.end();
    });

    it('TC1: 10 lid, 1 yaroqsiz, 2 dublikat → yaroqli lid 70%', async () => {
      const { rows } = await svc().platform({
        from: FROM,
        to: TO,
        groupBy: PlatformMetricsGroupBy.AFFILIATE,
      });
      expect(rows.find((r) => r.key === '42')).toMatchObject({
        leads: 10,
        invalid: 1,
        duplicates: 2,
        validLeads: 7,
        noContact: 1,
        validLeadRate: 70,
        lostLeadRate: 14, // 1 / 7
      });
    });

    it('kun kesimi: har ko‘rsatkich o‘z hodisa kunida; jami — o‘rtacha chek, EPC, birinchi qo‘ng‘iroq mediani', async () => {
      const r = await svc().platform({ from: FROM, to: TO });
      expect(
        r.rows.map((x) => [
          x.key,
          x.leads,
          x.confirmed,
          x.delivered,
          x.refused,
        ]),
      ).toEqual([
        ['2026-12-01', 12, 4, 0, 0],
        ['2026-12-02', 0, 0, 3, 1],
      ]);
      expect(r.totals).toEqual({
        key: 'TOTAL',
        clicks: 25,
        leads: 12,
        invalid: 1,
        duplicates: 2,
        validLeads: 9,
        noContact: 1,
        attempts: null,
        confirmed: 4,
        delivered: 3,
        refused: 1,
        validLeadRate: 75,
        approveRate: 44, // 4 / 9
        saleRate: 75, // 3 / (3 + 1)
        lostLeadRate: 11, // 1 / 9
        firstCallMedianMinutes: 15, // 5, 10, 20, 40
        averageCheck: 189000,
        affiliateIncome: 195000,
        epc: 7800, // 195 000 / 25
      });
    });

    it('TC2: sotuvchi kesimi BE-28 sotuvchi statistikasi bilan bir xil', async () => {
      const { rows } = await svc().platform({
        from: FROM,
        to: TO,
        groupBy: PlatformMetricsGroupBy.AFFILIATE,
      });
      expect(rows.map((r) => r.key)).toEqual(['42', '43']);
      for (const affiliateId of ['42', '43']) {
        const { totals } = await be28().affiliateStats({
          affiliateId,
          query: { from: FROM, to: TO },
        });
        const row = rows.find((r) => r.key === affiliateId)!;
        expect({
          clicks: row.clicks,
          leads: row.leads,
          validLeads: row.validLeads,
          confirmed: row.confirmed,
          delivered: row.delivered,
          refused: row.refused,
        }).toEqual({
          clicks: totals.clicks,
          leads: totals.leads,
          validLeads: totals.validLeads,
          confirmed: totals.confirmed,
          delivered: totals.delivered,
          refused: totals.refused,
        });
      }
    });

    it('TC2: operator kesimi BE-28 operator statistikasi bilan bir xil', async () => {
      const { rows, totals } = await svc().platform({
        from: FROM,
        to: TO,
        groupBy: PlatformMetricsGroupBy.OPERATOR,
      });
      expect(rows.map((r) => r.key)).toEqual(['41', '51']);
      for (const operatorId of ['41', '51']) {
        const own = await be28().operatorStats({
          operatorId,
          query: { from: FROM, to: TO },
        });
        const row = rows.find((r) => r.key === operatorId)!;
        expect({
          attempts: row.attempts,
          confirmed: row.confirmed,
          approveRate: row.approveRate,
          saleRate: row.saleRate,
          firstCallMedianMinutes: row.firstCallMedianMinutes,
        }).toEqual(own);
      }
      expect(rows.find((r) => r.key === '41')).toMatchObject({
        attempts: 3,
        confirmed: 2,
        approveRate: 100, // 2 / 2 ishlagan yaroqli
        saleRate: 50,
        firstCallMedianMinutes: 10, // 5, 10, 20
        leads: null,
        epc: null,
      });
      expect(totals).toMatchObject({ attempts: 5, confirmed: 4 });
    });

    it('offer kesimi — mahsulot bo‘yicha', async () => {
      const { rows } = await svc().platform({
        from: FROM,
        to: TO,
        groupBy: PlatformMetricsGroupBy.OFFER,
      });
      expect(
        rows.map((r) => [r.key, r.clicks, r.leads, r.delivered, r.epc]),
      ).toEqual([
        ['501', 20, 10, 2, 6500], // 2 × 65 000 / 20
        ['502', 5, 2, 1, 13000],
      ]);
    });

    it('bo‘sh kunlar ham qator; noto‘g‘ri davr — 400', async () => {
      const r = await svc().platform({ from: '2026-12-03', to: '2026-12-04' });
      expect(r.rows.map((x) => [x.key, x.leads, x.validLeadRate])).toEqual([
        ['2026-12-03', 0, null],
        ['2026-12-04', 0, null],
      ]);
      await expect(
        svc().platform({ from: TO, to: FROM }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc().platform({ from: '2025-01-01', to: TO }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  },
);
