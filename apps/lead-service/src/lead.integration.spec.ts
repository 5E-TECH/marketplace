import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  AffiliateOfferSort,
  AffiliateStreamStatus,
  CatalogOfferSnapshot,
  CheckoutDeliveryDestination,
  LandingPageState,
  LeadReviewReason,
  StreamTemplate,
  LeadSource,
  LeadStatus,
  LeadVariant,
} from '@app/common';
import {
  Click,
  LEAD_ENTITIES,
  Lead,
  LeadHistory,
  OfferContent,
  Stream,
} from './entities';
import { LandingService } from './landing.service';
import { LeadAddressService } from './lead-address.service';
import { HONEYPOT_LEAD_ID, LeadIntakeService } from './lead-intake.service';
import { OfferService } from './offer.service';
import { StreamService } from './stream.service';
import { CreateOfferContent1794873600000 } from './migrations/1794873600000-create-offer-content';
import { AddLeadReview1794960000000 } from './migrations/1794960000000-add-lead-review';
import { CreateLeadTables1794787200000 } from './migrations/1794787200000-create-lead-tables';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/**
 * BE-10 — haqiqiy PostgreSQL ustida. Faqat `lead` sxemasiga tegadi.
 *   TEST_DATABASE_URL=postgresql://.../marketplace_test npx jest lead.integration
 */
describeWithPostgres('lead-service sxemasi PostgreSQL (BE-10)', () => {
  let db: DataSource;

  const newStream = () =>
    db.getRepository(Stream).save({
      code: 'k7Qm2x',
      affiliateId: '42',
      productId: '501',
      salePrice: '189000',
    });

  const landingLead = (streamId: string, extra: Partial<Lead> = {}) =>
    db.getRepository(Lead).create({
      source: LeadSource.LANDING,
      streamId,
      affiliateId: '42',
      productId: '501',
      name: 'Aziza',
      phoneE164: '+998901234567',
      regionSoato: '1726',
      districtSoato: '1726266',
      addressLine: 'Turkiston ko‘chasi, 27-uy',
      whereDeliver: CheckoutDeliveryDestination.CENTER,
      salePrice: '189000',
      ...extra,
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
      ],
      synchronize: false,
      logging: false,
    });
    await db.initialize();
    // TC2: toza bazada migratsiya boshidan oxirigacha o‘tadi
    await db.query('DROP SCHEMA IF EXISTS lead CASCADE');
    await db.query('CREATE SCHEMA lead');
    await db.runMigrations();
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query('DROP SCHEMA IF EXISTS lead CASCADE');
      await db.destroy();
    }
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE ${LEAD_ENTITIES.map((e) => `lead.${db.getMetadata(e).tableName}`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  });

  it('TC2: migratsiyadan keyin entity lar bazaga mos (yozish va o‘qish)', async () => {
    const stream = await newStream();
    const click = await db.getRepository(Click).save({
      streamId: stream.id,
      variant: LeadVariant.S1,
      utmSource: 'facebook',
      ip: '203.0.113.7',
    });
    const lead = await db
      .getRepository(Lead)
      .save(
        landingLead(stream.id, { clickId: click.id, variant: LeadVariant.S1 }),
      );
    await db.getRepository(LeadHistory).save({
      leadId: lead.id,
      toStatus: LeadStatus.NEW,
    });

    const read = await db.getRepository(Lead).findOneByOrFail({ id: lead.id });
    expect(read).toMatchObject({
      status: LeadStatus.NEW,
      quantity: 1,
      attempts: 0,
      variant: 's1',
      regionSoato: '1726',
      whereDeliver: 'CENTER',
      isDeleted: false,
    });
    // Migratsiyada bor, entity da yo‘q ustun qolmasin
    for (const entity of LEAD_ENTITIES) {
      const meta = db.getMetadata(entity);
      const cols: { column_name: string }[] = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'lead' AND table_name = $1`,
        [meta.tableName],
      );
      expect(cols.map((c) => c.column_name).sort()).toEqual(
        meta.columns.map((c) => c.databaseName).sort(),
      );
    }
  });

  it('TC3: operator navbati so‘rovi indeksdan foydalanadi', async () => {
    const stream = await newStream();
    const rows = Array.from({ length: 2000 }, (_, i) =>
      landingLead(stream.id, {
        phoneE164: `+99890${String(1000000 + i)}`,
        status: i % 50 === 0 ? LeadStatus.NEW : LeadStatus.CONFIRMED,
        nextAttemptAt: new Date(Date.UTC(2026, 11, 1, 0, i % 60)),
      }),
    );
    await db.getRepository(Lead).save(rows, { chunk: 500 });
    await db.query('ANALYZE lead.lead');
    const plan: { 'QUERY PLAN': string }[] = await db.query(
      `EXPLAIN SELECT id FROM lead.lead
       WHERE status = 'NEW' AND next_attempt_at <= now()
       ORDER BY next_attempt_at LIMIT 1`,
    );
    expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toContain(
      'idx_lead_lead_status_next_attempt',
    );
  });

  it('TC4: click va lid variant — s1, s3 yoki bo‘sh; boshqa qiymat rad', async () => {
    const stream = await newStream();
    for (const variant of [LeadVariant.S1, LeadVariant.S3, null]) {
      await expect(
        db.getRepository(Click).save({ streamId: stream.id, variant }),
      ).resolves.toBeDefined();
      await expect(
        db.getRepository(Lead).save(
          landingLead(stream.id, {
            variant,
            phoneE164: `+99890${variant === null ? '0000000' : variant === LeadVariant.S1 ? '1111111' : '3333333'}`,
          }),
        ),
      ).resolves.toBeDefined();
    }
    await expect(
      db.query(
        `INSERT INTO lead.click (stream_id, variant) VALUES ($1, 's2')`,
        [stream.id],
      ),
    ).rejects.toThrow(/chk_lead_click_variant/);
    await expect(
      db
        .getRepository(Lead)
        .save(landingLead(stream.id, { variant: 's2' as LeadVariant })),
    ).rejects.toThrow(/chk_lead_lead_variant/);
  });

  it('sotuvchi sahifasi lidida manzil bo‘lmasa baza rad etadi; API lidida majburiy emas', async () => {
    const stream = await newStream();
    await expect(
      db
        .getRepository(Lead)
        .save(landingLead(stream.id, { addressLine: null })),
    ).rejects.toThrow(/chk_lead_lead_address_required/);
    await expect(
      db.getRepository(Lead).save(
        landingLead(stream.id, {
          source: LeadSource.API,
          regionSoato: null,
          districtSoato: null,
          addressLine: null,
          whereDeliver: null,
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('REJECTED sababsiz yozilmaydi', async () => {
    const stream = await newStream();
    await expect(
      db
        .getRepository(Lead)
        .save(landingLead(stream.id, { status: LeadStatus.REJECTED })),
    ).rejects.toThrow(/chk_lead_lead_rejected_reason/);
  });
  describe('BE-38: operator manzilni tasdiqlaydi yoki tuzatadi', () => {
    const resolution = {
      ok: true,
      regionSoato: '1726',
      regionName: 'Toshkent shahri',
      districtSoato: '1726266',
      districtName: 'Yunusobod tumani',
      elchiRegionId: '1',
      elchiDistrictId: '10',
    };
    const makeService = (result: unknown = resolution) =>
      new LeadAddressService(db, { send: jest.fn(() => of(result)) } as never);
    const formAddress = {
      regionSoato: '1726',
      districtSoato: '1726266',
      addressLine: 'Turkiston ko‘chasi, 27-uy',
      whereDeliver: CheckoutDeliveryDestination.CENTER,
    };
    const addressHistory = (leadId: string) =>
      db.getRepository(LeadHistory).find({
        where: { leadId },
        order: { id: 'ASC' },
      });

    it('o‘zgarishsiz saqlash — tasdiq: faqat tasdiq yozuvi, «tuzatdi» belgisi yo‘q', async () => {
      const stream = await newStream();
      const lead = await db.getRepository(Lead).save(landingLead(stream.id));
      const result = await makeService().confirmByOperator(
        lead.id,
        '41',
        formAddress,
      );
      expect(result).toMatchObject({
        regionName: 'Toshkent shahri',
        districtName: 'Yunusobod tumani',
        editedByOperator: false,
      });
      const saved = await db
        .getRepository(Lead)
        .findOneByOrFail({ id: lead.id });
      expect(saved.addressConfirmedBy).toBe('41');
      expect(saved.addressConfirmedAt).toBeInstanceOf(Date);
      const rows = await addressHistory(lead.id);
      expect(rows.map((r) => r.field)).toEqual(['address_confirmed_at']);
    });

    it('TC0: «Markazgacha» → «Eshikkacha»: where_deliver yangilandi, eski qiymat tarixda', async () => {
      const stream = await newStream();
      const lead = await db.getRepository(Lead).save(landingLead(stream.id));
      await makeService().confirmByOperator(lead.id, '41', {
        ...formAddress,
        whereDeliver: CheckoutDeliveryDestination.ADDRESS,
      });
      const saved = await db
        .getRepository(Lead)
        .findOneByOrFail({ id: lead.id });
      expect(saved.whereDeliver).toBe('ADDRESS');
      const change = (await addressHistory(lead.id)).find(
        (r) => r.field === 'where_deliver',
      );
      expect(change).toMatchObject({
        actorId: '41',
        oldValue: { value: 'CENTER' },
        newValue: { value: 'ADDRESS' },
        fromStatus: LeadStatus.NEW,
        toStatus: LeadStatus.NEW,
      });
    });

    it('TC5: ko‘cha/uy tuzatildi — eski va yangi qiymat, tasdiqlovchi shu operator, keyingi tasdiqda ham «tuzatdi»', async () => {
      const stream = await newStream();
      const lead = await db.getRepository(Lead).save(landingLead(stream.id));
      const first = await makeService().confirmByOperator(lead.id, '41', {
        ...formAddress,
        addressLine: 'Turkiston ko‘chasi, 29-uy',
      });
      expect(first.editedByOperator).toBe(true);
      const change = (await addressHistory(lead.id)).find(
        (r) => r.field === 'address_line',
      );
      expect(change).toMatchObject({
        oldValue: { value: 'Turkiston ko‘chasi, 27-uy' },
        newValue: { value: 'Turkiston ko‘chasi, 29-uy' },
      });
      const again = await makeService().confirmByOperator(lead.id, '42', {
        ...formAddress,
        addressLine: 'Turkiston ko‘chasi, 29-uy',
      });
      expect(again.editedByOperator).toBe(true);
      const saved = await db
        .getRepository(Lead)
        .findOneByOrFail({ id: lead.id });
      expect(saved.addressConfirmedBy).toBe('42');
    });

    it('TC2: tuman boshqa viloyatniki → 400, lid o‘zgarmaydi', async () => {
      const stream = await newStream();
      const lead = await db.getRepository(Lead).save(landingLead(stream.id));
      await expect(
        makeService({
          ok: false,
          field: 'districtSoato',
          error: 'districtSoato tanlangan viloyatga tegishli emas',
        }).confirmByOperator(lead.id, '41', {
          ...formAddress,
          districtSoato: '1703206',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      const saved = await db
        .getRepository(Lead)
        .findOneByOrFail({ id: lead.id });
      expect(saved.districtSoato).toBe('1726266');
      expect(saved.addressConfirmedAt).toBeNull();
      expect(await addressHistory(lead.id)).toEqual([]);
    });

    it('TC4: tasdiqdan oldin assertConfirmable 400, tasdiqdan keyin o‘tadi', async () => {
      const stream = await newStream();
      const lead = await db.getRepository(Lead).save(landingLead(stream.id));
      const service = makeService();
      expect(() => service.assertConfirmable(lead)).toThrow(
        BadRequestException,
      );
      await service.confirmByOperator(lead.id, '41', formAddress);
      const saved = await db
        .getRepository(Lead)
        .findOneByOrFail({ id: lead.id });
      expect(() => service.assertConfirmable(saved)).not.toThrow();
    });

    it('lid yo‘q → 404', async () => {
      await expect(
        makeService().confirmByOperator('999999', '41', formAddress),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('BE-11: offerlar, sotuvchi sahifasi va kliklar', () => {
    const offer = (
      productId: string,
      extra: Partial<CatalogOfferSnapshot> = {},
    ): CatalogOfferSnapshot => ({
      productId,
      name: 'Simsiz quloqchinlar',
      subtitle: 'Bluetooth, quvvatlovchi g‘ilof bilan',
      description: 'Telefonga Bluetooth orqali ulanadi.',
      images: ['https://cdn.example.uz/p/1.jpg'],
      videoUrl: null,
      categoryId: '12',
      categoryName: 'Elektronika',
      attributes: [{ name: 'Aloqa', value: 'Bluetooth' }],
      weightGrams: 300,
      isBad: false,
      cpaAvailable: true,
      withdrawn: false,
      approvedPrice: 251000,
      maxSalePrice: 276000,
      affiliateFee: 65000,
      centerDeliveryFee: 30000,
      addressDeliveryFee: 50000,
      stock: 120,
      creatives: [
        { id: '9001', type: 'VIDEO', url: 'https://cdn.example.uz/c/9001.mp4' },
      ],
      createdAt: '2026-11-10T09:00:00.000Z',
      ...extra,
    });
    let catalog: Record<string, CatalogOfferSnapshot>;
    const fakeCatalog = {
      get: jest.fn(async (id: string) => catalog[id] ?? null),
      list: jest.fn(async (q: { productIds?: string[] }) =>
        Object.values(catalog).filter(
          (o) => !q.productIds || q.productIds.includes(o.productId),
        ),
      ),
    };
    const config = new ConfigService({
      INTEGRATION_CREDENTIAL_SECRET: 'isolated-test-encryption-key-0001',
      LEAD_LANDING_BASE_URL: 'https://sahifa.test/',
    });
    const streams = () =>
      new StreamService(
        db.getRepository(Stream),
        db.getRepository(Click),
        db.getRepository(Lead),
        fakeCatalog as never,
        config,
      );
    const landing = () =>
      new LandingService(
        db.getRepository(Stream),
        db.getRepository(Click),
        db.getRepository(OfferContent),
        fakeCatalog as never,
      );
    const offers = () =>
      new OfferService(
        db.getRepository(Lead),
        db.getRepository(OfferContent),
        fakeCatalog as never,
      );

    beforeEach(() => {
      catalog = {
        '501': offer('501'),
        '502': offer('502', { name: 'Choynak' }),
      };
    });

    it('TC1: faqat offer ID → standart shablon, tasdiqlangan narx va tayyor havola', async () => {
      const s1 = await streams().create('77', '501');
      expect(s1.code).toMatch(/^[A-Za-z0-9]{6}$/);
      expect(s1).toMatchObject({
        productId: '501',
        productName: 'Simsiz quloqchinlar',
        template: StreamTemplate.STANDART,
        salePrice: 251000,
        status: AffiliateStreamStatus.ACTIVE,
        link: `https://sahifa.test/${s1.code}`,
        clicks: 0,
        leads: 0,
      });
    });

    it('TC2/TC3: uch sotuvchi — uch havola; bitta sotuvchida ikkita sahifa', async () => {
      const codes = await Promise.all(
        ['77', '78', '79'].map(
          async (a) => (await streams().create(a, '501')).code,
        ),
      );
      expect(new Set(codes).size).toBe(3);
      await streams().create('77', '501');
      const mine = await streams().list('77');
      expect(mine.total).toBe(2);
      expect(mine.items.every((i) => i.productId === '501')).toBe(true);
    });

    it('TC4: narx 276 000 saqlanadi, 277 000 va tasdiqlangandan past rad', async () => {
      const s1 = await streams().create('77', '501');
      await expect(
        streams().update('77', s1.id, { salePrice: 276000 }),
      ).resolves.toMatchObject({ salePrice: 276000 });
      for (const salePrice of [277000, 276100, 250000])
        await expect(
          streams().update('77', s1.id, { salePrice }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('katalog chegara bermasa narx faqat tasdiqlangan narx bo‘ladi', async () => {
      catalog['501'] = offer('501', { maxSalePrice: null });
      const s1 = await streams().create('77', '501');
      await expect(
        streams().update('77', s1.id, { salePrice: 251001 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        streams().update('77', s1.id, { salePrice: 251000 }),
      ).resolves.toMatchObject({ salePrice: 251000 });
    });

    it('TC5: qoldiq 0 offerga sahifa ochilmaydi', async () => {
      catalog['501'] = offer('501', { stock: 0 });
      await expect(streams().create('77', '501')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('TC6: sir va token shifrlanadi, javobda faqat belgisi', async () => {
      const s1 = await streams().create('77', '501');
      const dto = await streams().update('77', s1.id, {
        postbackSecret: 'maxfiy-sir-123',
        capiToken: 'capi-token-xyz',
        metaPixelId: '1234567890',
      });
      expect(dto).toMatchObject({
        hasPostbackSecret: true,
        hasCapiToken: true,
        metaPixelId: '1234567890',
      });
      expect(JSON.stringify(dto)).not.toMatch(/maxfiy-sir-123|capi-token-xyz/);
      const row = await db.getRepository(Stream).findOneByOrFail({ id: s1.id });
      expect(row.postbackSecretEnc).not.toContain('maxfiy-sir-123');
    });

    it('boshqa sotuvchining sahifasi o‘zgartirilmaydi (SOT-3)', async () => {
      const s1 = await streams().create('77', '501');
      await expect(
        streams().update('78', s1.id, { template: StreamTemplate.VIDEO }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('TC7: klik shu sahifaga sub, utm, variant, IP va user agent bilan yoziladi', async () => {
      const s1 = await streams().create('77', '501');
      const { clickId } = await landing().createClick(
        {
          code: s1.code,
          variant: LeadVariant.S3,
          sub1: 'kampaniya-1',
          utmSource: 'facebook',
          fbclid: 'fb.1',
        },
        { ip: '203.0.113.7', userAgent: 'Mozilla/5.0' },
      );
      expect(
        await db.getRepository(Click).findOneByOrFail({ id: clickId }),
      ).toMatchObject({
        streamId: s1.id,
        variant: 's3',
        sub1: 'kampaniya-1',
        utmSource: 'facebook',
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      });
      expect((await streams().list('77')).items[0].clicks).toBe(1);
      await expect(
        landing().createClick(
          { code: 'yoq123' },
          { ip: null, userAgent: null },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('TC10–TC12: sahifa holati — ochiq, vaqtincha yo‘q, qabul qilinmaydi, sotuvdan olingan', async () => {
      const s1 = await streams().create('77', '501');
      expect((await landing().getLanding(s1.code)).state).toBe(
        LandingPageState.OPEN,
      );
      catalog['501'] = offer('501', { stock: 0 });
      expect((await landing().getLanding(s1.code)).state).toBe(
        LandingPageState.OUT_OF_STOCK,
      );
      catalog['501'] = offer('501', { withdrawn: true });
      expect((await landing().getLanding(s1.code)).state).toBe(
        LandingPageState.WITHDRAWN,
      );
      catalog['501'] = offer('501');
      await db
        .getRepository(Stream)
        .update({ id: s1.id }, { status: AffiliateStreamStatus.STOPPED });
      expect((await landing().getLanding(s1.code)).state).toBe(
        LandingPageState.NOT_ACCEPTED,
      );
      await expect(landing().getLanding('yoq123')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('TC13: ochiq javobda bazaviy narx, sotuvchi haqi va optovik yo‘q; matnlar va xususiyatlar bor', async () => {
      const s1 = await streams().create('77', '501');
      await offers().updateContent('501', '1', {
        highlights: ['  Telefonga Bluetooth orqali ulanadi ', ''],
        boxContents: ['Quloqchinlar (juft)', 'Quvvat kabeli'],
      });
      const page = await landing().getLanding(s1.code);
      const json = JSON.stringify(page);
      for (const hidden of [
        'affiliateFee',
        'approvedPrice',
        'basePrice',
        'wholesaler',
        '65000',
        'variant',
      ])
        expect(json).not.toContain(hidden);
      expect(page.price).toEqual({
        salePrice: 251000,
        centerDeliveryFee: 30000,
        addressDeliveryFee: 50000,
      });
      expect(page.product.highlights).toEqual([
        'Telefonga Bluetooth orqali ulanadi',
      ]);
      expect(page.product.boxContents).toEqual([
        'Quloqchinlar (juft)',
        'Quvvat kabeli',
      ]);
      expect(page.product.specs).toEqual([
        { name: 'Aloqa', value: 'Bluetooth' },
        { name: 'Og‘irlik', value: '0.3 kg' },
        { name: 'Kategoriya', value: 'Elektronika' },
      ]);
    });

    it('offerlar: tasdiq foizi liddan, filtr «tasdiq ≥ 50%» va saralash (FE-05 TC5)', async () => {
      const s1 = await streams().create('77', '501');
      const statuses = [
        LeadStatus.CONFIRMED,
        LeadStatus.NEW,
        LeadStatus.NO_CONTACT,
        LeadStatus.INVALID,
      ];
      for (const [i, status] of statuses.entries())
        await db.getRepository(Lead).save(
          landingLead(s1.id, {
            productId: '501',
            status,
            phoneE164: `+99891000000${i}`,
          }),
        );
      const all = await offers().listForAffiliate({
        sort: AffiliateOfferSort.APPROVE_RATE,
      });
      expect(all.items.map((o) => [o.productId, o.approveRate])).toEqual([
        ['501', 33],
        ['502', null],
      ]);
      expect(all.items[0]).toMatchObject({
        maxSalePrice: 276000,
        affiliateFee: 65000,
        epc: null,
        saleRate: null,
        hasVideo: true,
      });
      await expect(
        offers().listForAffiliate({ minApproveRate: 50 }),
      ).resolves.toMatchObject({ total: 0, items: [] });
      await expect(
        offers().listForAffiliate({ minApproveRate: 30 }),
      ).resolves.toMatchObject({ total: 1 });
    });
  });

  describe('BE-12: lid qabul qilish', () => {
    const geo = {
      ok: true,
      regionSoato: '1726',
      regionName: 'Toshkent shahri',
      districtSoato: '1726266',
      districtName: 'Yunusobod tumani',
      elchiRegionId: '1',
      elchiDistrictId: '10',
    };
    const snapshot = (extra: Partial<CatalogOfferSnapshot> = {}) =>
      ({
        productId: '501',
        name: 'Simsiz quloqchinlar',
        subtitle: null,
        description: null,
        images: [],
        videoUrl: null,
        categoryId: null,
        categoryName: null,
        attributes: [],
        weightGrams: 300,
        isBad: false,
        cpaAvailable: true,
        withdrawn: false,
        approvedPrice: 251000,
        maxSalePrice: 276000,
        affiliateFee: 65000,
        centerDeliveryFee: 30000,
        addressDeliveryFee: 50000,
        stock: 10,
        creatives: [],
        createdAt: '2026-11-10T09:00:00.000Z',
        ...extra,
      }) as CatalogOfferSnapshot;
    let offerNow: CatalogOfferSnapshot;
    let geoResult: unknown;
    const intake = (codes = '90,91,93,94,95,97,98,99') =>
      new LeadIntakeService(
        db,
        db.getRepository(Stream),
        { get: jest.fn(async () => offerNow) } as never,
        new LeadAddressService(db, {
          send: jest.fn(() => of(geoResult)),
        } as never),
        new ConfigService({ LEAD_PHONE_OPERATOR_CODES: codes }),
      );
    const streamFor = (affiliateId: string, code: string) =>
      db.getRepository(Stream).save({
        code,
        affiliateId,
        productId: '501',
        salePrice: '262000',
      });
    const form = (code: string, extra: Record<string, unknown> = {}) =>
      ({
        code,
        name: 'Aziza',
        phone: '+998901234567',
        regionSoato: '1726',
        districtSoato: '1726266',
        addressLine: 'Turkiston ko‘chasi, 27-uy',
        whereDeliver: CheckoutDeliveryDestination.ADDRESS,
        consentVersion: '2026-11-16',
        ...extra,
      }) as never;
    const submit = (
      code: string,
      extra: Record<string, unknown> = {},
      ip: string | null = '203.0.113.7',
    ) =>
      intake().create({
        lead: form(code, extra),
        ip,
        userAgent: 'Mozilla/5.0',
      });
    const lead = (id: string) => db.getRepository(Lead).findOneByOrFail({ id });

    beforeEach(() => {
      offerNow = snapshot();
      geoResult = geo;
    });

    it('TC0, TC1, TC5, TC6: to‘liq forma → lid yoziladi: manzil, yetkazish turi, variant, rozilik, narx', async () => {
      await streamFor('77', 'aaaaaa');
      const res = await submit('aaaaaa', { variant: LeadVariant.S3 });
      expect(res.duplicate).toBe(false);
      const row = await lead(res.leadId);
      expect(row).toMatchObject({
        source: LeadSource.LANDING,
        status: LeadStatus.NEW,
        affiliateId: '77',
        productId: '501',
        whereDeliver: 'ADDRESS',
        regionSoato: '1726',
        districtSoato: '1726266',
        variant: 's3',
        consentVersion: '2026-11-16',
        salePrice: '262000',
        reviewReason: null,
      });
      expect(row.consentAt).toBeInstanceOf(Date);
      expect(row.nextAttemptAt).toBeInstanceOf(Date);
      expect(
        row.expiresAt!.getTime() - row.createdAt.getTime(),
      ).toBeGreaterThan(2.9 * 24 * 3600 * 1000);
    });

    it('TC0: A sotuvchi sahifasidan → lid A ga, B dan → B ga', async () => {
      await streamFor('77', 'aaaaaa');
      await streamFor('78', 'bbbbbb');
      const a = await submit('aaaaaa', { phone: '+998901111111' });
      const b = await submit('bbbbbb', { phone: '+998902222222' });
      expect((await lead(a.leadId)).affiliateId).toBe('77');
      expect((await lead(b.leadId)).affiliateId).toBe('78');
    });

    it('TC1: operator kodi ro‘yxatda bo‘lmasa 400', async () => {
      await streamFor('77', 'aaaaaa');
      await expect(
        submit('aaaaaa', { phone: '+998121234567' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('TC2: shu raqam va mahsulot 10 kundan keyin → avvalgi lidga, birinchi sotuvchi va variant', async () => {
      await streamFor('77', 'aaaaaa');
      await streamFor('78', 'bbbbbb');
      const first = await submit('aaaaaa', { variant: LeadVariant.S1 });
      await db.query(
        `UPDATE lead.lead SET created_at = now() - interval '10 days' WHERE id = $1`,
        [first.leadId],
      );
      const second = await submit(
        'bbbbbb',
        { variant: LeadVariant.S3 },
        '198.51.100.9',
      );
      expect(second.duplicate).toBe(true);
      const merged = await lead(second.leadId);
      expect(merged).toMatchObject({
        status: LeadStatus.MERGED,
        mergedIntoId: first.leadId,
        affiliateId: '78',
      });
      expect(await lead(first.leadId)).toMatchObject({
        status: LeadStatus.NEW,
        affiliateId: '77',
        variant: 's1',
      });
      expect(
        await db
          .getRepository(Lead)
          .count({ where: { status: LeadStatus.NEW } }),
      ).toBe(1);
    });

    it('30 kundan keyin xuddi shu raqam (avvalgisi yopilgan) — yangi lid', async () => {
      await streamFor('77', 'aaaaaa');
      const first = await submit('aaaaaa');
      await db.query(
        `UPDATE lead.lead SET created_at = now() - interval '31 days', status = 'CONFIRMED' WHERE id = $1`,
        [first.leadId],
      );
      await expect(submit('aaaaaa')).resolves.toMatchObject({
        duplicate: false,
      });
    });

    it('10-qoida: «Aloqa bo‘lmadi» lid qayta ochiladi', async () => {
      await streamFor('77', 'aaaaaa');
      const first = await submit('aaaaaa');
      await db.query(
        `UPDATE lead.lead SET status = 'NO_CONTACT', attempts = 6 WHERE id = $1`,
        [first.leadId],
      );
      const again = await submit('aaaaaa');
      expect(again.duplicate).toBe(true);
      expect(await lead(first.leadId)).toMatchObject({
        status: LeadStatus.NEW,
        attempts: 0,
      });
    });

    it('9/10-qoidalar: «Rad etildi» 3 kun ichida qo‘shiladi, keyin yangi lid yangi sotuvchiga', async () => {
      await streamFor('77', 'aaaaaa');
      await streamFor('78', 'bbbbbb');
      const first = await submit('aaaaaa');
      await db.query(
        `UPDATE lead.lead SET status = 'REJECTED', reject_reason = 'TOO_EXPENSIVE' WHERE id = $1`,
        [first.leadId],
      );
      await db.getRepository(LeadHistory).save({
        leadId: first.leadId,
        fromStatus: LeadStatus.BOOKED,
        toStatus: LeadStatus.REJECTED,
      });
      await db.query(
        `UPDATE lead.lead_history SET created_at = now() - interval '2 days' WHERE lead_id = $1 AND to_status = 'REJECTED'`,
        [first.leadId],
      );
      // 2-kuni yana ariza: qo‘shiladi, 3 kunlik oyna esa siljimasligi kerak
      await expect(submit('bbbbbb')).resolves.toMatchObject({
        duplicate: true,
      });
      await db.query(
        `UPDATE lead.lead_history SET created_at = created_at - interval '2 days' WHERE lead_id = $1 AND to_status = 'REJECTED' AND from_status <> 'REJECTED' AND field IS NULL`,
        [first.leadId],
      );
      const fresh = await submit('bbbbbb');
      expect(fresh.duplicate).toBe(false);
      expect((await lead(fresh.leadId)).affiliateId).toBe('78');
    });

    it('TC3: bir IP dan 10 daqiqada 6-ariza → tekshiruvga', async () => {
      await streamFor('77', 'aaaaaa');
      const ids: string[] = [];
      for (let i = 0; i < 6; i++)
        ids.push(
          (await submit('aaaaaa', { phone: `+99890300000${i}` })).leadId,
        );
      const rows = await Promise.all(ids.map(lead));
      expect(rows.slice(0, 5).every((r) => r.reviewReason === null)).toBe(true);
      expect(rows[5].reviewReason).toBe(LeadReviewReason.IP_RATE);
    });

    it('bir IP dan parallel 8 ta ariza → aniq 3 tasi tekshiruvga', async () => {
      await streamFor('77', 'aaaaaa');
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          submit('aaaaaa', { phone: `+99890310000${i}` }),
        ),
      );
      const rows = await Promise.all(results.map((r) => lead(r.leadId)));
      expect(
        rows.filter((r) => r.reviewReason === LeadReviewReason.IP_RATE),
      ).toHaveLength(3);
    });

    it('tekshiruvga tushgan ariza «Aloqa bo‘lmadi» lidni navbatga ochiq qaytarmaydi', async () => {
      await streamFor('77', 'aaaaaa');
      const root = await submit(
        'aaaaaa',
        { phone: '+998903200000' },
        '198.51.100.1',
      );
      await db.query(
        `UPDATE lead.lead SET status = 'NO_CONTACT' WHERE id = $1`,
        [root.leadId],
      );
      for (let i = 0; i < 5; i++)
        await submit('aaaaaa', { phone: `+99890330000${i}` }, '198.51.100.2');
      await submit('aaaaaa', { phone: '+998903200000' }, '198.51.100.2');
      expect(await lead(root.leadId)).toMatchObject({
        status: LeadStatus.NEW,
        reviewReason: LeadReviewReason.IP_RATE,
      });
    });

    it('LID-4: faol lid 30 kundan eski bo‘lsa ham ikkinchi faol lid ochilmaydi', async () => {
      await streamFor('77', 'aaaaaa');
      const first = await submit('aaaaaa');
      await db.query(
        `UPDATE lead.lead SET created_at = now() - interval '31 days' WHERE id = $1`,
        [first.leadId],
      );
      await expect(submit('aaaaaa')).resolves.toMatchObject({
        duplicate: true,
      });
      expect(
        await db
          .getRepository(Lead)
          .count({ where: { status: LeadStatus.NEW } }),
      ).toBe(1);
    });

    it('TC4: yashirin maydon to‘ldirilgan → lid yozilmaydi, javob baribir', async () => {
      await streamFor('77', 'aaaaaa');
      await expect(submit('aaaaaa', { website: 'bot' })).resolves.toEqual({
        leadId: HONEYPOT_LEAD_ID,
        duplicate: false,
      });
      expect(await db.getRepository(Lead).count()).toBe(0);
    });

    it('TC7: 2 marta rad etgan raqam — lid tarixida qora ro‘yxat belgisi (chora EQ-04 da)', async () => {
      const stream = await streamFor('77', 'aaaaaa');
      for (const [i, product] of ['601', '602'].entries())
        await db.getRepository(Lead).save(
          landingLead(stream.id, {
            productId: product,
            status: LeadStatus.REJECTED,
            rejectReason: 'NOT_NEEDED' as never,
            phoneE164: '+998901234567',
            name: `R${i}`,
          }),
        );
      const res = await submit('aaaaaa');
      const notes = await db
        .getRepository(LeadHistory)
        .find({ where: { leadId: res.leadId } });
      expect(notes.some((n) => n.field === 'blacklist')).toBe(true);
    });

    it('sahifa ochiq emas (qoldiq 0) → 409; noto‘g‘ri tuman → 400; kod yo‘q → 404', async () => {
      await streamFor('77', 'aaaaaa');
      offerNow = snapshot({ stock: 0 });
      await expect(submit('aaaaaa')).rejects.toBeInstanceOf(ConflictException);
      offerNow = snapshot();
      geoResult = {
        ok: false,
        field: 'districtSoato',
        error: 'districtSoato tanlangan viloyatga tegishli emas',
      };
      await expect(submit('aaaaaa')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(submit('yoq123')).rejects.toBeInstanceOf(NotFoundException);
      expect(await db.getRepository(Lead).count()).toBe(0);
    });

    it('ikki marta bosilgan forma (parallel) — bitta yangi lid, ikkinchisi dublikat', async () => {
      await streamFor('77', 'aaaaaa');
      const [a, b] = await Promise.all([submit('aaaaaa'), submit('aaaaaa')]);
      expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
      expect(
        await db
          .getRepository(Lead)
          .count({ where: { status: LeadStatus.NEW } }),
      ).toBe(1);
    });

    it('boshqa sahifaning click_id si e’tiborga olinmaydi, o‘ziniki — variant klikdan', async () => {
      const own = await streamFor('77', 'aaaaaa');
      const other = await streamFor('78', 'bbbbbb');
      const foreign = await db
        .getRepository(Click)
        .save({ streamId: other.id, variant: LeadVariant.S1 });
      const mine = await db
        .getRepository(Click)
        .save({ streamId: own.id, variant: LeadVariant.S3 });
      const r1 = await submit('aaaaaa', {
        clickId: foreign.id,
        phone: '+998904000001',
      });
      expect((await lead(r1.leadId)).clickId).toBeNull();
      const r2 = await submit('aaaaaa', {
        clickId: mine.id,
        phone: '+998904000002',
      });
      expect(await lead(r2.leadId)).toMatchObject({
        clickId: mine.id,
        variant: 's3',
      });
    });
  });
});
