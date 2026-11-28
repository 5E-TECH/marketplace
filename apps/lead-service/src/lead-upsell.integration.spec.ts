import { ValidationPipe } from '@nestjs/common';
import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  AddLeadItemDto,
  CatalogOfferSnapshot,
  CheckoutDeliveryDestination,
  LEAD_EVENTS,
  LeadOrderStatus,
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
import { LeadOrderService } from './lead-order.service';
import { OperatorBonusService } from './operator-bonus.service';
import { orderEvent } from '../../finance-service/src/ledger/order-events.samples';
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

  it('tasdiqdan oldin: qo‘shimcha tovar tugagan yoki sotuvdan olingan — 409 (buyurtma yaratilmay lid aylanmaydi); ekranda OUT_OF_STOCK', async () => {
    const lead = await mkLead();
    await upsell().add('41', lead.id, '512', 2);
    offers['512'] = { ...offers['512'], stock: 1 };
    await expect(
      queue().submitResult('41', lead.id, {
        outcome: LeadOutcome.CONFIRMED,
      } as never),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Oshxona tarozisi: omborda 1 dona'),
    });
    expect((await upsell().get('41', lead.id)).pair).toMatchObject({
      unavailableReason: 'OUT_OF_STOCK',
    });
    offers['512'] = { ...offers['512'], stock: 45, withdrawn: true };
    await expect(
      queue().submitResult('41', lead.id, {
        outcome: LeadOutcome.CONFIRMED,
      } as never),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Oshxona tarozisi sotuvda emas'),
    });
    expect(
      (await db.getRepository(Lead).findOneByOrFail({ id: lead.id })).status,
    ).toBe(LeadStatus.BOOKED);
    expect(await confirmedEvents(lead.id)).toEqual([]);
  });

  it('bron tasdiqsiz tugasa — qo‘shimcha tovar olib tashlanadi: boshqa natija, bron muddati, buyurtma yaratilmadi', async () => {
    // rad: keyin qayta ochilsa ham rad etilgan qo‘shimcha tovar buyurtmaga tushmaydi
    const rejected = await mkLead();
    await upsell().add('41', rejected.id, '512', 1);
    await queue().submitResult('41', rejected.id, {
      outcome: LeadOutcome.REJECTED,
      rejectReason: 'TOO_EXPENSIVE',
    } as never);
    expect(await rows(rejected.id)).toEqual([]);

    // bron muddati tugadi (5-qoida)
    const expired = await mkLead();
    await upsell().add('41', expired.id, '512', 1);
    await db.query(
      `UPDATE lead.lead SET booked_until = now() - interval '1 minute' WHERE id = $1`,
      [expired.id],
    );
    await queue().sweep(new Date());
    expect(
      (await db.getRepository(Lead).findOneByOrFail({ id: expired.id })).status,
    ).toBe(LeadStatus.NEW);
    expect(await rows(expired.id)).toEqual([]);

    // buyurtma yaratilmadi: qo‘shimcha tovar olib tashlanadi, «qoldiq yo‘q» belgisi qo‘yilmaydi
    const failed = await mkLead();
    await upsell().add('41', failed.id, '512', 1);
    await queue().submitResult('41', failed.id, {
      outcome: LeadOutcome.CONFIRMED,
    } as never);
    await queue().onOrderCreateFailed({
      eventId: 'f-1',
      leadId: failed.id,
      reason: 'OUT_OF_STOCK' as never,
      at: new Date(Date.now() + 1000).toISOString(),
    });
    const after = await db
      .getRepository(Lead)
      .findOneByOrFail({ id: failed.id });
    expect(after).toMatchObject({
      status: LeadStatus.CALLBACK,
      stockShortageAt: null,
    });
    expect(await rows(failed.id)).toEqual([]);
    const notes = (
      await db.getRepository(LeadHistory).find({
        where: { leadId: failed.id },
        order: { id: 'ASC' },
      })
    ).map((h) => h.note);
    expect(notes).toEqual(
      expect.arrayContaining([
        'Qo‘shimcha tovar olib tashlandi (buyurtma yaratilmadi): Oshxona tarozisi × 1',
        expect.stringContaining(
          'qo‘shimcha tovar olib tashlandi, navbatga qaytdi',
        ),
      ]),
    );
  });

  it('«Mijoz olmadi» — faqat joriy bron ichida ko‘rinadi', async () => {
    const lead = await mkLead();
    await db.getRepository(LeadHistory).save({
      leadId: lead.id,
      fromStatus: LeadStatus.NEW,
      toStatus: LeadStatus.BOOKED,
      actorId: '41',
      note: 'Operator oldi',
    });
    expect((await upsell().decline('41', lead.id)).declinedAt).not.toBeNull();
    // keyingi bron (boshqa qo‘ng‘iroq)
    await db.getRepository(LeadHistory).save({
      leadId: lead.id,
      fromStatus: LeadStatus.CALLBACK,
      toStatus: LeadStatus.BOOKED,
      actorId: '41',
      note: 'Operator oldi',
    });
    expect((await upsell().get('41', lead.id)).declinedAt).toBeNull();
  });

  describe('TC6: operatorga upsell bonusi (ega qarori 2026-11-28)', () => {
    const bonus = () => new OperatorBonusService(db);
    const orders = () =>
      new LeadOrderService(db, undefined, undefined, bonus());
    let seq = 0;
    const status = (lead: Lead, s: LeadOrderStatus, at: Date) =>
      orders().onOrderStatusChanged(
        orderEvent({
          eventId: `bonus-${++seq}`,
          orderId: String(90_000 + Number(lead.id)),
          leadId: lead.id,
          streamId: lead.streamId,
          affiliateId: lead.affiliateId,
          status: s,
          occurredAt: at.toISOString(),
        }),
      );
    /** Operator qo‘shimcha tovar(lar) qo‘shib tasdiqlagan lid. */
    const upsold = async (operatorId: string, products: string[]) => {
      const lead = await mkLead({ operatorId });
      for (const productId of products)
        await upsell().add(operatorId, lead.id, productId, 1);
      await queue().submitResult(operatorId, lead.id, {
        outcome: LeadOutcome.CONFIRMED,
      } as never);
      return db.getRepository(Lead).findOneByOrFail({ id: lead.id });
    };
    const today = () =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(
        new Date(),
      );
    const statsOf = (operatorId: string) => {
      jest
        .spyOn(LeadStatsService.prototype as never, 'todayTashkent' as never)
        .mockReturnValue(today() as never);
      return new LeadStatsService(db, {} as never).operatorStats({
        operatorId,
        query: { from: today(), to: today() },
      });
    };
    const rowsOf = (leadId: string) =>
      db.query(
        `SELECT operator_id::text AS "operatorId", product_id::text AS "productId", amount::int AS amount,
                cancelled_at IS NOT NULL AS cancelled
           FROM lead.operator_bonus WHERE lead_id = $1 ORDER BY id`,
        [leadId],
      ) as Promise<Array<Record<string, unknown>>>;

    it('sozlama 0 — bonus yozilmaydi; summa o‘zgartirilsa eski bonuslar o‘z summasi bilan qoladi', async () => {
      expect(await bonus().settings()).toMatchObject({
        upsellBonus: 0,
        updatedBy: null,
      });
      offers['516'] = offer('516', { name: 'Kabel', approvedPrice: 20_000 });
      const free = await upsold('61', ['512']);
      await status(free, LeadOrderStatus.DELIVERED, new Date());
      expect(await rowsOf(free.id)).toEqual([]);

      // sinov qiymati (summa — superadmin sozlamasidan, TZ da raqam yo‘q)
      await expect(bonus().updateSettings('1', 10_000)).resolves.toMatchObject({
        upsellBonus: 10_000,
        updatedBy: '1',
      });
      const first = await upsold('61', ['512']);
      await status(first, LeadOrderStatus.DELIVERED, new Date());
      await bonus().updateSettings('1', 15_000);
      const second = await upsold('61', ['516']);
      await status(second, LeadOrderStatus.DELIVERED, new Date());
      expect(await rowsOf(first.id)).toEqual([
        {
          operatorId: '61',
          productId: '512',
          amount: 10_000,
          cancelled: false,
        },
      ]);
      expect(await rowsOf(second.id)).toEqual([
        {
          operatorId: '61',
          productId: '516',
          amount: 15_000,
          cancelled: false,
        },
      ]);
      await bonus().updateSettings('1', 0);
    });

    it('2 ta qo‘shimcha tovarli buyurtma yetkazildi → 20 000; rad etilgan va qaytarilgan — bonus yo‘q; har qo‘shilgan tovarga bitta', async () => {
      await bonus().updateSettings('1', 10_000); // sinov qiymati
      offers['516'] = offer('516', { name: 'Kabel', approvedPrice: 20_000 });
      const now = new Date();
      const a = await upsold('62', ['512']);
      const b = await upsold('62', ['516']);
      const refused = await upsold('62', ['512']);
      const returned = await upsold('62', ['516']);
      const two = await upsold('63', ['512', '516']);
      await status(a, LeadOrderStatus.DELIVERED, now);
      await status(b, LeadOrderStatus.DELIVERED, now);
      // takror va keyingi holatlar — ikkinchi bonus yo‘q
      await status(a, LeadOrderStatus.REMITTED, now);
      await status(a, LeadOrderStatus.DELIVERED, now);
      await status(refused, LeadOrderStatus.REFUSED, now);
      await status(refused, LeadOrderStatus.RETURNING, now);
      await status(returned, LeadOrderStatus.DELIVERED, now);
      await status(returned, LeadOrderStatus.RETURN_REQUESTED, now);
      await status(returned, LeadOrderStatus.RETURNING, now);
      await status(two, LeadOrderStatus.DELIVERED, now);

      expect(await rowsOf(a.id)).toHaveLength(1);
      expect(await rowsOf(refused.id)).toEqual([]);
      expect(await rowsOf(returned.id)).toEqual([
        expect.objectContaining({ cancelled: true }),
      ]);
      expect(await statsOf('62')).toMatchObject({
        upsellBonus: 20_000,
        upsellBonusCount: 2,
      });
      // bitta buyurtmada 2 ta qo‘shimcha tovar — 2 ta bonus
      expect(await rowsOf(two.id)).toHaveLength(2);
      expect(await statsOf('63')).toMatchObject({
        upsellBonus: 20_000,
        upsellBonusCount: 2,
      });
      await bonus().updateSettings('1', 0);
    });

    it('qaytarish hodisasi «yetkazildi» dan oldin kelsa — bonus yozilmaydi', async () => {
      await bonus().updateSettings('1', 10_000); // sinov qiymati
      const lead = await upsold('64', ['512']);
      const t0 = new Date();
      await status(
        lead,
        LeadOrderStatus.RETURNING,
        new Date(t0.getTime() + 2000),
      );
      await status(lead, LeadOrderStatus.DELIVERED, t0);
      expect(await rowsOf(lead.id)).toEqual([]);
      await bonus().updateSettings('1', 0);
    });
  });
});
