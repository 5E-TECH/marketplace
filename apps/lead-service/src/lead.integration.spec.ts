import { BadRequestException, NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  CheckoutDeliveryDestination,
  LeadSource,
  LeadStatus,
  LeadVariant,
} from '@app/common';
import { Click, LEAD_ENTITIES, Lead, LeadHistory, Stream } from './entities';
import { LeadAddressService } from './lead-address.service';
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
      migrations: [CreateLeadTables1794787200000],
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
});
