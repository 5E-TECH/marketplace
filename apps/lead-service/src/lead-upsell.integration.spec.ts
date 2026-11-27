import { ValidationPipe } from '@nestjs/common';
import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  AddLeadItemDto,
  CatalogOfferSnapshot,
  CheckoutDeliveryDestination,
  LEAD_EVENTS,
  LeadConfirmedEvent,
  LeadOutcome,
  LeadSource,
  LeadStatus,
  OutboxEvent,
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
import { LeadAddressService } from './lead-address.service';
import { LeadCardService } from './lead-card.service';
import { LeadQueueService } from './lead-queue.service';
import { LeadStatsService } from './lead-stats.service';
import { tashkentParts } from './lead-schedule';
import {
  isInsideWindow,
  LeadUpsellService,
  parseUpsellWindow,
} from './lead-upsell.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
/** lead sxemasini qayta yaratadigan integratsiya testlari ketma-ket (BE-31). */
const LEAD_SCHEMA_TEST_LOCK = 2_304_002;

/** 12-qoida oynasi — sof funksiya (Toshkent = UTC+5). */
describe('BE-45: 12-qoida oynasi', () => {
  const window = parseUpsellWindow('09:00-18:00')!;
  it('bo‘sh — qoida o‘chiq; noto‘g‘ri — yopiq', () => {
    expect(parseUpsellWindow(undefined)).toBeNull();
    expect(parseUpsellWindow('  ')).toBeNull();
    for (const bad of ['9-18', '18:00-09:00', '09:00-09:00', '25:00-26:00'])
      expect(parseUpsellWindow(bad)?.invalid).toBe(true);
    expect(
      isInsideWindow(parseUpsellWindow('x')!, new Date('2026-12-01T06:00Z')),
    ).toBe(false);
  });
  it.each([
    ['2026-12-01T03:59:00Z', false], // 08:59
    ['2026-12-01T04:00:00Z', true], // 09:00
    ['2026-12-01T12:59:00Z', true], // 17:59
    ['2026-12-01T13:00:00Z', false], // 18:00 — tashqarida
    ['2026-12-01T18:00:00Z', false], // 23:00
  ])('%s → %s', (at, inside) => {
    expect(isInsideWindow(window, new Date(at))).toBe(inside);
  });
});

/**
 * BE-45 haqiqiy PostgreSQL da (lead sxemasi). Katalog — namuna: lid tovari 501 (juftligi 512), 512 — tarozi
 * (tasdiqlangan 85 000, qoldiq 45), 513 — qoldiq 0, 514 — narx tasdiqlanmagan.
 *   TEST_DATABASE_URL=postgresql://.../elchi_lead_test npx jest lead-upsell.integration --runInBand
 */
describeWithPostgres('BE-45 qo‘shimcha tovar (PostgreSQL)', () => {
  let db: DataSource;
  let lock: Client | undefined;
  let offers: Record<string, CatalogOfferSnapshot>;
  const offer = (
    productId: string,
    over: Partial<CatalogOfferSnapshot> = {},
  ): CatalogOfferSnapshot => ({
    productId,
    name: `Tovar ${productId}`,
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
    approvedPrice: 100_000,
    maxSalePrice: null,
    affiliateFee: 25_000,
    centerDeliveryFee: 30_000,
    addressDeliveryFee: 50_000,
    stock: 10,
    creatives: [],
    upsellProductId: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...over,
  });
  const catalogFake = {
    get: jest.fn(async (id: string) => offers[String(id)] ?? null),
    list: jest.fn(async () => []),
    orderSnapshotMany: jest.fn(
      async (items: Array<{ productId: string; quantity: number }>) => ({
        items: items.map(({ productId }) => ({
          weightGrams: offers[productId]?.weightGrams ?? 0,
        })),
        delivery: { shown: 30_000, mode: 'PARTIAL' },
      }),
    ),
  };
  const cards = () =>
    new LeadCardService(
      db.getRepository(Lead),
      db.getRepository(LeadAttempt),
      db.getRepository(LeadHistory),
      db.getRepository(OfferContent),
      catalogFake as never,
      {
        send: () => of({ deliveryFee: 30_000, deliveryMode: 'PARTIAL' }),
      } as never,
      { send: () => of([]) } as never,
    );
  const upsell = () => new LeadUpsellService(db, catalogFake as never, cards());
  const queue = () =>
    new LeadQueueService(
      db,
      new LeadAddressService(db, { send: () => of([]) } as never),
      undefined,
      undefined,
      undefined,
      undefined,
      upsell(),
    );
  let phone = 0;
  let stream: Stream;
  const mkLead = (over: Partial<Lead> = {}) =>
    db.getRepository(Lead).save(
      db.getRepository(Lead).create({
        source: LeadSource.LANDING,
        streamId: stream.id,
        affiliateId: '77',
        productId: '501',
        name: 'Aziza',
        phoneE164: `+99890${String(7000000 + phone++).padStart(7, '0')}`,
        regionSoato: '1726',
        districtSoato: '1726266',
        addressLine: 'Turkiston ko‘chasi, 27-uy',
        whereDeliver: CheckoutDeliveryDestination.CENTER,
        salePrice: '189000',
        status: LeadStatus.BOOKED,
        operatorId: '41',
        bookedUntil: new Date(Date.now() + 10 * 60_000),
        addressConfirmedAt: new Date(),
        addressConfirmedBy: '41',
        ...over,
      }),
    );
  const confirmedEvents = async (leadId: string) =>
    (
      await db.getRepository(OutboxEvent).find({
        where: { eventType: LEAD_EVENTS.CONFIRMED, aggregateId: leadId },
      })
    ).map((row) => row.payload as unknown as LeadConfirmedEvent);
  const rows = (leadId: string) =>
    db
      .getRepository(LeadItem)
      .find({ where: { leadId }, order: { position: 'ASC' } });

  beforeAll(async () => {
    if (!new URL(url!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    lock = new Client({ connectionString: url });
    await lock.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [LEAD_SCHEMA_TEST_LOCK]);
    db = new DataSource({
      type: 'postgres',
      url,
      schema: 'lead',
      entities: LEAD_DB.entities,
      migrations: LEAD_DB.migrations,
      synchronize: false,
      logging: false,
    });
    await db.initialize();
    await db.query('DROP SCHEMA IF EXISTS lead CASCADE');
    await db.query('CREATE SCHEMA lead');
    await db.runMigrations();
    stream = await db.getRepository(Stream).save({
      code: 'up1',
      affiliateId: '77',
      productId: '501',
      salePrice: '189000',
    });
  }, 300_000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query('DROP SCHEMA IF EXISTS lead CASCADE');
      await db.destroy();
    }
    await lock?.end();
  });

  beforeEach(() => {
    delete process.env.UPSELL_WINDOW;
    offers = {
      '501': offer('501', {
        name: 'Simsiz quloqchinlar',
        approvedPrice: 189_000,
        upsellProductId: '512',
      }),
      '512': offer('512', {
        name: 'Oshxona tarozisi',
        approvedPrice: 85_000,
        stock: 45,
        weightGrams: 350,
      }),
      '513': offer('513', { name: 'Bolalar termosi', stock: 0 }),
      '514': offer('514', { approvedPrice: null }),
      '515': offer('515', { withdrawn: true, cpaAvailable: false }),
    };
  });

  afterAll(() => {
    delete process.env.UPSELL_WINDOW;
  });

  it('TC1: qo‘shimcha tovar qo‘shildi va tasdiqlandi → lead.confirmed ikki qator bilan, ikkinchisi belgilangan', async () => {
    const lead = await mkLead();
    const offerView = await upsell().get('41', lead.id);
    expect(offerView).toMatchObject({
      pair: {
        productId: '512',
        name: 'Oshxona tarozisi',
        price: 85_000,
        stock: 45,
        unavailableReason: null,
      },
      window: null,
      lines: [],
      declinedAt: null,
    });

    const card = await upsell().add('41', lead.id, '512', 1);
    expect(card.items).toEqual([
      expect.objectContaining({
        productId: '501',
        quantity: 1,
        unitPrice: 189_000,
        upsell: false,
      }),
      expect.objectContaining({
        productId: '512',
        name: 'Oshxona tarozisi',
        quantity: 1,
        unitPrice: 85_000,
        lineTotal: 85_000,
        upsell: true,
      }),
    ]);
    // butun posilka: tovar 189 000 + 85 000, yetkazish bir marta
    expect(card.price).toMatchObject({
      subtotal: 274_000,
      deliveryFee: 30_000,
      totalAmount: 304_000,
    });
    expect((await upsell().get('41', lead.id)).pair?.unavailableReason).toBe(
      'IN_LEAD',
    );
    const history = await db
      .getRepository(LeadHistory)
      .find({ where: { leadId: lead.id, field: 'upsell_item' } });
    expect(history.map((h) => [h.actorId, h.note])).toEqual([
      ['41', 'Qo‘shimcha tovar qo‘shildi: Oshxona tarozisi × 1, 85 000 so‘m'],
    ]);

    await queue().submitResult('41', lead.id, {
      outcome: LeadOutcome.CONFIRMED,
      quantity: 2,
    } as never);
    const [event] = await confirmedEvents(lead.id);
    expect(event).toMatchObject({
      productId: '501',
      quantity: 2,
      salePrice: 189_000,
      items: [
        { productId: '501', quantity: 2, salePrice: 189_000 },
        { productId: '512', quantity: 1, salePrice: 85_000, upsell: true },
      ],
    });
    expect(event.items![0]).not.toHaveProperty('upsell');
  });

  it('TC2: qoldig‘i 0 yoki yetmaydigan tovar → 400; narx tasdiqlanmagan, sotuvda emas → 400; ombor noma’lum → 503', async () => {
    const lead = await mkLead();
    await expect(upsell().add('41', lead.id, '513', 1)).rejects.toMatchObject({
      status: 400,
      message: 'Qoldiq tugagan — taklif qilinmaydi',
    });
    await expect(upsell().add('41', lead.id, '512', 46)).rejects.toMatchObject({
      status: 400,
      message: 'Qoldiq yetarli emas: omborda 45 dona',
    });
    await expect(upsell().add('41', lead.id, '514', 1)).rejects.toMatchObject({
      status: 400,
    });
    await expect(upsell().add('41', lead.id, '515', 1)).rejects.toMatchObject({
      status: 400,
    });
    offers['512'] = { ...offers['512'], stock: null };
    await expect(upsell().add('41', lead.id, '512', 1)).rejects.toMatchObject({
      status: 503,
    });
    expect(await rows(lead.id)).toEqual([]);
    // juftlik qoldig‘i 0 — ekranda «taklif qilinmaydi»
    offers['501'] = { ...offers['501'], upsellProductId: '513' };
    expect((await upsell().get('41', lead.id)).pair).toMatchObject({
      productId: '513',
      unavailableReason: 'OUT_OF_STOCK',
    });
  });

  it('TC3: narx yuborilmaydi (400); qatorda tasdiqlangan narx; narx o‘zgarsa tasdiq 409 va qator yangilanadi', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await expect(
      pipe.transform(
        { productId: '512', quantity: 1, price: 1000 },
        { type: 'body', metatype: AddLeadItemDto },
      ),
    ).rejects.toMatchObject({ status: 400 });

    const lead = await mkLead();
    await upsell().add('41', lead.id, '512', 1);
    expect((await rows(lead.id))[1].salePrice).toBe('85000');
    offers['512'] = { ...offers['512'], approvedPrice: 90_000 };
    await expect(
      queue().submitResult('41', lead.id, {
        outcome: LeadOutcome.CONFIRMED,
      } as never),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await db.getRepository(Lead).findOneByOrFail({ id: lead.id })).status,
    ).toBe(LeadStatus.BOOKED);
    expect((await rows(lead.id))[1].salePrice).toBe('90000');
    await queue().submitResult('41', lead.id, {
      outcome: LeadOutcome.CONFIRMED,
    } as never);
    const [event] = await confirmedEvents(lead.id);
    expect(event.items![1]).toMatchObject({
      productId: '512',
      salePrice: 90_000,
      upsell: true,
    });
  });

  it('TC4: 12-qoida yoqilgan — oynadan tashqarida qo‘shish rad, ichida qo‘shiladi', async () => {
    const { hour } = tashkentParts(new Date());
    // hozirgi Toshkent soatidan uzoq oyna — aniq yopiq
    process.env.UPSELL_WINDOW = hour < 12 ? '20:00-21:00' : '02:00-03:00';
    const lead = await mkLead();
    await expect(upsell().add('41', lead.id, '512', 1)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('(12-qoida); hozir'),
    });
    expect((await upsell().get('41', lead.id)).window).toMatchObject({
      open: false,
    });
    expect(await rows(lead.id)).toEqual([]);
    process.env.UPSELL_WINDOW = '00:00-23:59';
    if (hour * 60 + tashkentParts(new Date()).minute < 23 * 60 + 59) {
      await upsell().add('41', lead.id, '512', 1);
      expect(await rows(lead.id)).toHaveLength(2);
    }
  });

  it('TC5: upsell foizi — qo‘shimcha qatorli tasdiqlar ulushi', async () => {
    const leads: Lead[] = [];
    for (let i = 0; i < 4; i++) leads.push(await mkLead({ operatorId: '45' }));
    await upsell().add('45', leads[0].id, '512', 1);
    for (const lead of leads)
      await queue().submitResult('45', lead.id, {
        outcome: LeadOutcome.CONFIRMED,
      } as never);
    // tasdiqlanmagan lid (qo‘shimcha tovari bor) hisobga kirmaydi
    const pending = await mkLead({ operatorId: '45' });
    await upsell().add('45', pending.id, '512', 1);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tashkent',
    }).format(new Date());
    jest
      .spyOn(LeadStatsService.prototype as never, 'todayTashkent' as never)
      .mockReturnValue(today as never);
    const stats = await new LeadStatsService(db, {} as never).operatorStats({
      operatorId: '45',
      query: { from: today, to: today },
    });
    expect(stats).toMatchObject({ confirmed: 4, upsellRate: 25 });
  });

  it('olib tashlash, «Mijoz olmadi», egalik: faqat qo‘shimcha qator; begona lid — 404; takror — 409', async () => {
    const lead = await mkLead();
    await expect(upsell().add('99', lead.id, '512', 1)).rejects.toMatchObject({
      status: 404,
    });
    await expect(upsell().add('41', lead.id, '501', 1)).rejects.toMatchObject({
      status: 409,
    });
    const card = await upsell().add('41', lead.id, '512', 1);
    await expect(upsell().add('41', lead.id, '512', 1)).rejects.toMatchObject({
      status: 409,
    });
    const [main, extra] = card.items;
    await expect(
      upsell().remove('41', lead.id, main.itemId),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      upsell().remove('99', lead.id, extra.itemId),
    ).rejects.toMatchObject({ status: 404 });
    const after = await upsell().remove('41', lead.id, extra.itemId);
    // sotuvchi sahifasi lidi — bitta tovarli shaklga qaytdi
    expect(after.items).toEqual([]);
    expect(await rows(lead.id)).toEqual([]);

    const declined = await upsell().decline('41', lead.id);
    expect(declined.declinedAt).not.toBeNull();
    const notes = (
      await db.getRepository(LeadHistory).find({
        where: { leadId: lead.id },
        order: { id: 'ASC' },
      })
    )
      .map((h) => h.note)
      .filter((n) => n?.startsWith('Qo‘shimcha'));
    expect(notes).toEqual([
      'Qo‘shimcha tovar qo‘shildi: Oshxona tarozisi × 1, 85 000 so‘m',
      'Qo‘shimcha tovar olib tashlandi: Oshxona tarozisi × 1',
      'Qo‘shimcha taklif: mijoz olmadi',
    ]);
    // natija kiritilgach (bron tugadi) — qo‘shib bo‘lmaydi
    await queue().submitResult('41', lead.id, {
      outcome: LeadOutcome.CONFIRMED,
    } as never);
    await expect(upsell().add('41', lead.id, '512', 1)).rejects.toMatchObject({
      status: 404,
    });
    const [event] = await confirmedEvents(lead.id);
    expect(event.items).toBeUndefined();
  });

  it('saytdan ko‘p tovarli lid: qo‘shimcha qator qo‘shiladi, olib tashlansa sayt qatorlari qoladi', async () => {
    const lead = await mkLead({
      source: LeadSource.SITE,
      streamId: null,
      affiliateId: null,
    });
    const repo = db.getRepository(LeadItem);
    await repo.save([
      repo.create({
        leadId: lead.id,
        position: 0,
        productId: '501',
        productName: 'Simsiz quloqchinlar',
        quantity: 1,
        salePrice: '189000',
      }),
      repo.create({
        leadId: lead.id,
        position: 1,
        productId: '513',
        productName: 'Bolalar termosi',
        quantity: 1,
        salePrice: '100000',
      }),
    ]);
    const card = await upsell().add('41', lead.id, '512', 2);
    expect(card.items.map((i) => [i.productId, i.upsell])).toEqual([
      ['501', false],
      ['513', false],
      ['512', true],
    ]);
    const after = await upsell().remove('41', lead.id, card.items[2].itemId);
    expect(after.items.map((i) => i.productId)).toEqual(['501', '513']);
  });
});
