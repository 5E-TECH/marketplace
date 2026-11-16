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
import { OfferService } from './offer.service';
import { StreamService } from './stream.service';
import { CreateOfferContent1794873600000 } from './migrations/1794873600000-create-offer-content';
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

    it('narx katalog chegarasida: tasdiqlangan narx oshsa yoki chegara tushsa sahifa narxi moslashadi', async () => {
      const s1 = await streams().create('77', '501');
      await streams().update('77', s1.id, { salePrice: 276000 });
      catalog['501'] = offer('501', {
        approvedPrice: 262000,
        maxSalePrice: 288000,
      });
      expect((await landing().getLanding(s1.code)).price.salePrice).toBe(
        276000,
      );
      catalog['501'] = offer('501', {
        approvedPrice: 251000,
        maxSalePrice: 260000,
      });
      expect((await landing().getLanding(s1.code)).price.salePrice).toBe(
        260000,
      );
      catalog['501'] = offer('501', {
        approvedPrice: 280000,
        maxSalePrice: 300000,
      });
      expect((await landing().getLanding(s1.code)).price.salePrice).toBe(
        280000,
      );
      expect((await streams().list('77')).items[0].salePrice).toBe(280000);
    });

    it('template: null o‘zgartirmaydi (500 emas)', async () => {
      const s1 = await streams().create('77', '501');
      await expect(
        streams().update('77', s1.id, { template: null } as never),
      ).resolves.toMatchObject({ template: StreamTemplate.STANDART });
    });

    it('TC11: sotuvchi bloklandi → uning sahifalari «qabul qilinmaydi»; blokdan chiqsa ochiladi', async () => {
      const s1 = await streams().create('77', '501');
      const other = await streams().create('78', '501');
      await expect(
        streams().setAffiliateStreamsStatus(
          '77',
          AffiliateStreamStatus.STOPPED,
        ),
      ).resolves.toEqual({ updated: 1 });
      expect((await landing().getLanding(s1.code)).state).toBe(
        LandingPageState.NOT_ACCEPTED,
      );
      expect((await landing().getLanding(other.code)).state).toBe(
        LandingPageState.OPEN,
      );
      await streams().setAffiliateStreamsStatus(
        '77',
        AffiliateStreamStatus.ACTIVE,
      );
      expect((await landing().getLanding(s1.code)).state).toBe(
        LandingPageState.OPEN,
      );
    });

    it('ochiq sahifada kreativlar; mahsulot videosi bo‘lmasa kreativdagi video', async () => {
      const s1 = await streams().create('77', '501');
      const page = await landing().getLanding(s1.code);
      expect(page.product.videoUrl).toBe('https://cdn.example.uz/c/9001.mp4');
      expect(page.product.creatives).toEqual([
        { id: '9001', type: 'VIDEO', url: 'https://cdn.example.uz/c/9001.mp4' },
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
});
