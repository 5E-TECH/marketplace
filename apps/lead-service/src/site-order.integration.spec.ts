import { Client } from 'pg';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  CatalogOfferSnapshot,
  CheckoutDeliveryDestination,
  LEAD_EVENTS,
  LeadConfirmedEvent,
  LeadConfirmedVia,
  LeadRejectReason,
  LeadSource,
  LeadStatus,
  OutboxEvent,
  SiteConfirmMode,
  SiteConfirmSmsEvent,
} from '@app/common';
import { LEAD_DB } from './database';
import {
  Lead,
  LeadAttempt,
  LeadHistory,
  LeadItem,
  OfferContent,
  Stream,
} from './entities';
import { LeadCardService } from './lead-card.service';
import { LeadAddressService } from './lead-address.service';
import { LeadIntakeService } from './lead-intake.service';
import { SiteOrderService, SMS_CONFIRM_WINDOW_MIN } from './site-order.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;
/** lead sxemasini DROP/CREATE qiladigan spec’lar bilan bir xil qulf (lead.integration.spec). */
const LEAD_SCHEMA_TEST_LOCK = 2_304_002;
const CONFIRM_URL = 'https://elchimarket.uz/buyurtma/tasdiq';

/** BE-34: saytdan mehmon buyurtmasi → lid (haqiqiy PostgreSQL). Katalog va geo — namuna. */
describeWithPostgres('BE-34 saytdan buyurtma (PostgreSQL)', () => {
  let db: DataSource;
  let schemaLock: Client | undefined;
  const geo = {
    ok: true,
    regionSoato: '1726',
    regionName: 'Toshkent shahri',
    districtSoato: '1726266',
    districtName: 'Yunusobod tumani',
    elchiRegionId: '1',
    elchiDistrictId: '10',
  };
  const offer = (
    productId: string,
    extra: Partial<CatalogOfferSnapshot> = {},
  ): CatalogOfferSnapshot => ({
    productId,
    name: productId === '501' ? 'Simsiz quloqchin' : 'Termos 1 l',
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
    approvedPrice: productId === '501' ? 251_000 : 120_000,
    maxSalePrice: null,
    affiliateFee: 65_000,
    centerDeliveryFee: 30_000,
    addressDeliveryFee: 50_000,
    stock: 10,
    creatives: [],
    createdAt: '2026-11-10T09:00:00.000Z',
    ...extra,
  });
  let offers: CatalogOfferSnapshot[];
  const catalog = {
    list: jest.fn(async ({ productIds }: { productIds: string[] }) =>
      offers.filter((o) => productIds.includes(o.productId)),
    ),
    orderSnapshotMany: jest.fn(async () => ({
      items: [],
      delivery: { mode: 'PARTIAL', shown: 50_000, elchiTariff: 60_000 },
    })),
  };
  const service = (url: string | null = CONFIRM_URL) => {
    const config = new ConfigService({
      LEAD_PHONE_OPERATOR_CODES: '90,91,93,94,95,97,98,99',
      ...(url ? { SITE_ORDER_CONFIRM_URL: url } : {}),
    });
    const address = new LeadAddressService(db, {
      send: jest.fn(() => of(geo)),
    } as never);
    const intake = new LeadIntakeService(
      db,
      db.getRepository(Stream),
      catalog as never,
      address,
      config,
    );
    return new SiteOrderService(db, catalog as never, address, intake, config);
  };
  const order = (extra: Record<string, unknown> = {}) =>
    ({
      name: 'Aziza',
      phone: '+998901234567',
      regionSoato: '1726',
      districtSoato: '1726266',
      addressLine: 'Turkiston ko‘chasi, 27-uy',
      whereDeliver: CheckoutDeliveryDestination.ADDRESS,
      confirmMode: SiteConfirmMode.CALL,
      consentVersion: '2026-11-16',
      ...extra,
    }) as never;
  const twoItems = [
    { productId: '501', quantity: 1 },
    { productId: '502', quantity: 2 },
  ];
  const outbox = (eventType: string, leadId: string) =>
    db.getRepository(OutboxEvent).find({
      where: { eventType, aggregateId: leadId },
      order: { id: 'ASC' },
    });
  const tokenOf = async (leadId: string) => {
    const [sms] = await outbox(LEAD_EVENTS.SITE_CONFIRM_SMS, leadId);
    const text = (sms.payload as unknown as SiteConfirmSmsEvent).text;
    return text.slice(text.lastIndexOf('/') + 1);
  };

  beforeAll(async () => {
    if (!new URL(testDatabaseUrl!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    db = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      schema: 'lead',
      entities: LEAD_DB.entities as never,
      migrations: LEAD_DB.migrations as never,
      synchronize: false,
      logging: false,
    });
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
    await schemaLock?.end();
  });

  beforeEach(async () => {
    offers = [offer('501'), offer('502')];
    await db.query(
      'TRUNCATE lead.lead_item, lead.lead_history, lead.outbox_event, lead.lead RESTART IDENTITY CASCADE',
    );
  });

  it('TC1: savatda 2 tovar, to‘liq manzil → bitta lid: manba SITE, sahifa, sotuvchi va variant yo‘q; ikki qator tasdiqlangan narxda', async () => {
    const result = await service().create({
      order: order(),
      lines: twoItems,
      ip: '203.0.113.7',
      userAgent: 'jest',
    });
    expect(result.confirmMode).toBe(SiteConfirmMode.CALL);
    const lead = await db
      .getRepository(Lead)
      .findOneByOrFail({ id: result.leadId });
    expect(lead).toMatchObject({
      source: LeadSource.SITE,
      streamId: null,
      affiliateId: null,
      variant: null,
      status: LeadStatus.NEW,
      productId: '501',
      quantity: 1,
      salePrice: '251000',
      confirmMode: 'CALL',
      regionSoato: '1726',
      districtSoato: '1726266',
    });
    // qo‘ng‘iroq: darhol navbatda
    expect(lead.nextAttemptAt!.getTime()).toBeLessThanOrEqual(Date.now());
    const items = await db
      .getRepository(LeadItem)
      .find({ where: { leadId: lead.id }, order: { position: 'ASC' } });
    expect(
      items.map(({ productId, quantity, salePrice, position }) => ({
        productId,
        quantity,
        salePrice,
        position,
      })),
    ).toEqual([
      { productId: '501', quantity: 1, salePrice: '251000', position: 0 },
      { productId: '502', quantity: 2, salePrice: '120000', position: 1 },
    ]);
    expect(await outbox(LEAD_EVENTS.SITE_CONFIRM_SMS, lead.id)).toEqual([]);
  });

  it('sotuvda bo‘lmagan mahsulot → 409; bir xil mahsulot qatorlari birlashadi; bo‘sh savat → 400', async () => {
    offers = [offer('501'), offer('502', { approvedPrice: null })];
    await expect(
      service().create({
        order: order(),
        lines: twoItems,
        ip: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    offers = [offer('501')];
    const merged = await service().create({
      order: order({ phone: '+998901234500' }),
      lines: [
        { productId: '501', quantity: 1 },
        { productId: '501', quantity: 2 },
      ],
      ip: null,
      userAgent: null,
    });
    await expect(
      db.getRepository(LeadItem).find({ where: { leadId: merged.leadId } }),
    ).resolves.toEqual([
      expect.objectContaining({ productId: '501', quantity: 3 }),
    ]);
    await expect(
      service().create({
        order: order(),
        lines: [],
        ip: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('lid kartasi (FE-29): saytdan ko‘p tovar — qatorlar va butun posilka jami, tasdiqlash usuli', async () => {
    const result = await service().create({
      order: order({ phone: '+998901234599' }),
      lines: twoItems,
      ip: null,
      userAgent: null,
    });
    const cards = new LeadCardService(
      db.getRepository(Lead),
      db.getRepository(LeadAttempt),
      db.getRepository(LeadHistory),
      db.getRepository(OfferContent),
      { ...catalog, get: jest.fn(async () => offers[0]) } as never,
      { send: jest.fn() } as never,
      { send: jest.fn() } as never,
    );
    const card = await cards.build(
      await db.getRepository(Lead).findOneByOrFail({ id: result.leadId }),
    );
    expect(card.items).toEqual([
      {
        productId: '501',
        name: 'Simsiz quloqchin',
        quantity: 1,
        unitPrice: 251_000,
        lineTotal: 251_000,
      },
      {
        productId: '502',
        name: 'Termos 1 l',
        quantity: 2,
        unitPrice: 120_000,
        lineTotal: 240_000,
      },
    ]);
    expect(card.price).toMatchObject({
      quantity: 3,
      subtotal: 491_000,
      deliveryFee: 50_000,
      totalAmount: 541_000,
    });
    expect(card.confirmMode).toBe('CALL');
  });

  it('TC6: SMS tanlandi → SMS havola (summa, tovarlar, manzil) → bosildi → «Tasdiqlandi», tasdiqlovchi mijoz, buyurtma hodisasi qatorlar bilan', async () => {
    const result = await service().create({
      order: order({ confirmMode: SiteConfirmMode.SMS }),
      lines: twoItems,
      ip: '203.0.113.8',
      userAgent: 'jest',
    });
    expect(result.confirmMode).toBe(SiteConfirmMode.SMS);
    const [sms] = await outbox(LEAD_EVENTS.SITE_CONFIRM_SMS, result.leadId);
    const payload = sms.payload as unknown as SiteConfirmSmsEvent;
    expect(payload.phone).toBe('+998901234567');
    // 251 000 + 2 × 120 000 + yetkazish 50 000
    expect(payload.text).toContain('541 000 so‘m');
    expect(payload.text).toContain('Simsiz quloqchin ×1, Termos 1 l ×2');
    expect(payload.text).toContain('Turkiston ko‘chasi, 27-uy');
    expect(payload.text).toMatch(
      new RegExp(`${CONFIRM_URL}/[A-Za-z0-9_-]{43}$`),
    );
    const lead = await db
      .getRepository(Lead)
      .findOneByOrFail({ id: result.leadId });
    // bazada faqat xesh; havola muddati tugaguncha operator navbatida ko‘rinmaydi
    expect(lead.smsTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.text).not.toContain(lead.smsTokenHash!);
    expect(lead.nextAttemptAt!.getTime()).toBeGreaterThan(
      Date.now() + (SMS_CONFIRM_WINDOW_MIN - 1) * 60_000,
    );

    const token = await tokenOf(result.leadId);
    await expect(service().confirm(token)).resolves.toEqual({
      status: 'CONFIRMED',
    });
    // takror bosish — o‘sha javob, ikkinchi buyurtma hodisasi yo‘q
    await expect(service().confirm(token)).resolves.toEqual({
      status: 'CONFIRMED',
    });
    const confirmed = await db
      .getRepository(Lead)
      .findOneByOrFail({ id: result.leadId });
    expect(confirmed).toMatchObject({
      status: LeadStatus.CONFIRMED,
      confirmedVia: LeadConfirmedVia.SMS,
      confirmedBy: null,
    });
    const events = await outbox(LEAD_EVENTS.CONFIRMED, result.leadId);
    expect(events).toHaveLength(1);
    expect(events[0].payload as unknown as LeadConfirmedEvent).toMatchObject({
      source: LeadSource.SITE,
      affiliateId: null,
      confirmedBy: null,
      confirmedVia: LeadConfirmedVia.SMS,
      productId: '501',
      quantity: 1,
      salePrice: 251_000,
      items: [
        { productId: '501', quantity: 1, salePrice: 251_000 },
        { productId: '502', quantity: 2, salePrice: 120_000 },
      ],
    });
    await expect(service().confirm('x'.repeat(43))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('TC7: SMS havola bosilmadi → muddatdan keyin operator navbatida, havola endi ishlamaydi (409)', async () => {
    const result = await service().create({
      order: order({ confirmMode: SiteConfirmMode.SMS }),
      lines: twoItems,
      ip: null,
      userAgent: null,
    });
    const token = await tokenOf(result.leadId);
    // muddat o‘tdi
    await db.query(
      `UPDATE lead.lead SET sms_expires_at = now() - interval '1 second', next_attempt_at = now() - interval '1 second'
        WHERE id = $1`,
      [result.leadId],
    );
    const [queued] = (await db.query(
      `SELECT count(*)::int AS n FROM lead.lead
        WHERE id = $1 AND status = 'NEW' AND (next_attempt_at IS NULL OR next_attempt_at <= now())`,
      [result.leadId],
    )) as Array<{ n: number }>;
    expect(queued.n).toBe(1);
    await expect(service().confirm(token)).rejects.toMatchObject({
      status: 409,
    });
    expect(await outbox(LEAD_EVENTS.CONFIRMED, result.leadId)).toEqual([]);
  });

  it('SMS berilmaydi: qora ro‘yxat, dublikat yoki tasdiq sahifasi sozlanmagan — lid qo‘ng‘iroq bilan', async () => {
    // qora ro‘yxat: shu raqam 2 marta rad etgan
    for (const productId of ['801', '802'])
      await db.getRepository(Lead).save(
        db.getRepository(Lead).create({
          source: LeadSource.SITE,
          productId,
          name: 'Aziza',
          phoneE164: '+998907777777',
          regionSoato: '1726',
          districtSoato: '1726266',
          addressLine: 'Turkiston ko‘chasi, 27-uy',
          whereDeliver: CheckoutDeliveryDestination.ADDRESS,
          quantity: 1,
          salePrice: '100000',
          status: LeadStatus.REJECTED,
          rejectReason: Object.values(LeadRejectReason)[0],
        }),
      );
    const blacklisted = await service().create({
      order: order({
        phone: '+998907777777',
        confirmMode: SiteConfirmMode.SMS,
      }),
      lines: twoItems,
      ip: null,
      userAgent: null,
    });
    expect(blacklisted.confirmMode).toBe(SiteConfirmMode.CALL);

    const first = await service().create({
      order: order({ confirmMode: SiteConfirmMode.CALL }),
      lines: twoItems,
      ip: null,
      userAgent: null,
    });
    const duplicate = await service().create({
      order: order({ confirmMode: SiteConfirmMode.SMS }),
      lines: twoItems,
      ip: null,
      userAgent: null,
    });
    expect(duplicate.confirmMode).toBe(SiteConfirmMode.CALL);
    await expect(
      db.getRepository(Lead).findOneByOrFail({ id: duplicate.leadId }),
    ).resolves.toMatchObject({
      status: LeadStatus.MERGED,
      mergedIntoId: first.leadId,
    });

    const noUrl = await service(null).create({
      order: order({
        phone: '+998905555555',
        confirmMode: SiteConfirmMode.SMS,
      }),
      lines: twoItems,
      ip: null,
      userAgent: null,
    });
    expect(noUrl.confirmMode).toBe(SiteConfirmMode.CALL);
  });

  it('TC8: bazada SMS faqat sayt lidida bo‘lishi mumkin (CHECK)', async () => {
    await expect(
      db.query(
        `INSERT INTO lead.lead (source, product_id, name, phone_e164, region_soato, district_soato, address_line,
                                where_deliver, quantity, sale_price, status, confirm_mode)
         VALUES ('LANDING', 501, 'Aziza', '+998901234567', '1726', '1726266', 'Turkiston 27', 'ADDRESS', 1, 100000,
                 'NEW', 'SMS')`,
      ),
    ).rejects.toThrow(/chk_lead_lead_confirm_mode/);
  });
});
