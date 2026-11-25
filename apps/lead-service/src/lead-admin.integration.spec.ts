import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  AdminLeadSort,
  AdminLeadTab,
  AffiliatePostbackStatus,
  CallChannel,
  CallEndReason,
  CallStatus,
  CheckoutDeliveryDestination,
  FraudActionType,
  LeadErrorCode,
  LeadExportColumn,
  LeadOutcome,
  LeadRejectReason,
  LeadReviewDecision,
  LeadReviewReason,
  LeadReviewResult,
  LeadSource,
  LeadStatus,
  OperatorActivityKind,
  OperatorWorkState,
} from '@app/common';
import { LEAD_DB } from './database';
import {
  Call,
  Lead,
  LeadAttempt,
  LeadHistory,
  OfferContent,
  OperatorState,
  PostbackDelivery,
  Stream,
} from './entities';
import { FraudService } from './fraud.service';
import { LeadAdminService } from './lead-admin.service';
import { closesAtOf, deviceOf, leadNumber } from './lead-admin-view';
import { LeadCardService } from './lead-card.service';
import { LeadQueueService } from './lead-queue.service';
import { LeadSupervisorService } from './lead-supervisor.service';
import { CallService } from './telephony/call.service';
import { TelephonyProvider } from './telephony/telephony.provider';
import { UserNamesClient } from './user-names.client';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
/** lead sxemasini qayta yaratadigan spec’lar ketma-ket (lead.integration.spec.ts dagi qulf). */
const LEAD_SCHEMA_TEST_LOCK = 2_304_002;
const MIN = 60_000;
const NOW = new Date('2027-01-14T09:38:00.000Z'); // 14:38 Toshkent

describe('BE-25 (FE-26): ko‘rinish yordamchilari', () => {
  it('lid raqami: «L-1284», «l1284», «1284»; boshqasi — yo‘q', () => {
    expect(leadNumber('L-1284')).toBe('1284');
    expect(leadNumber(' l1284 ')).toBe('1284');
    expect(leadNumber('1284')).toBe('1284');
    expect(leadNumber('k7m2qa')).toBeNull();
    expect(leadNumber('0')).toBeNull();
    expect(leadNumber('9'.repeat(19))).toBeNull(); // bigint dan katta
  });

  it('qurilma user agent dan; aniqlanmasa — null', () => {
    expect(
      deviceOf(
        'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
      ),
    ).toBe('Android · Chrome');
    expect(
      deviceOf(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 350.0',
      ),
    ).toBe('iPhone · Instagram');
    expect(
      deviceOf(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('iPhone · Safari');
    expect(deviceOf('curl/8.4.0')).toBeNull();
    expect(deviceOf(null)).toBeNull();
  });

  it('avtomatik yopilish vaqti: mijoz aytgan qo‘ng‘iroq va qo‘ng‘iroq qilinmagan lid — yo‘q (2-qoida)', () => {
    const expiresAt = new Date('2027-01-17T09:00:00.000Z');
    const base = {
      operatorId: null,
      bookedFromCallback: false,
      attempts: 1,
      expiresAt,
    };
    expect(closesAtOf({ ...base, status: LeadStatus.CALLBACK })).toBe(
      expiresAt,
    );
    expect(
      closesAtOf({ ...base, status: LeadStatus.CALLBACK, operatorId: '41' }),
    ).toBeNull();
    expect(
      closesAtOf({ ...base, status: LeadStatus.NEW, attempts: 0 }),
    ).toBeNull();
    expect(
      closesAtOf({ ...base, status: LeadStatus.BOOKED, operatorId: '41' }),
    ).toBe(expiresAt);
    expect(
      closesAtOf({
        ...base,
        status: LeadStatus.BOOKED,
        operatorId: '41',
        bookedFromCallback: true,
      }),
    ).toBeNull();
    expect(closesAtOf({ ...base, status: LeadStatus.REJECTED })).toBeNull();
  });
});

describeWithPostgres('BE-25 (FE-26): admin lidlari PostgreSQL da', () => {
  let db: DataSource;
  let lock: Client;
  let stream: Stream;
  let seq = 0;

  const catalogFake = {
    get: jest.fn(async () => ({
      productId: '501',
      name: 'Simsiz quloqchinlar',
      categoryName: 'Elektronika',
      weightGrams: 300,
      centerDeliveryFee: 30000,
      addressDeliveryFee: 45000,
    })),
    list: jest.fn(async () => [
      { productId: '501', name: 'Simsiz quloqchinlar' },
      { productId: '502', name: 'Elektr choynak' },
    ]),
  };
  const names = new UserNamesClient({
    send: () =>
      of([
        { id: '41', name: 'Dilnoza R.' },
        { id: '42', name: 'Umida S.' },
        { id: '77', name: 'Jasur T.' },
        { id: '7', name: 'Nodira K.' },
      ]),
  } as never);
  const regionTree = [
    { satoCode: '1726', name: 'Toshkent shahri', districts: [] },
  ];
  const calls = (configured = true) => {
    const config = new ConfigService({
      TELEPHONY_API_URL: configured ? 'http://127.0.0.1:9' : '',
      TELEPHONY_API_TOKEN: 't',
      TELEPHONY_CALLER_ID: '+998712000000',
      INTEGRATION_CREDENTIAL_SECRET: 'isolated-test-secret-0001',
    });
    return new CallService(db, new TelephonyProvider(config), config, names);
  };
  const cards = () =>
    new LeadCardService(
      db.getRepository(Lead),
      db.getRepository(LeadAttempt),
      db.getRepository(LeadHistory),
      db.getRepository(OfferContent),
      catalogFake as never,
      {
        send: () => of({ deliveryFee: 30000, deliveryMode: 'PARTIAL' }),
      } as never,
      {
        send: (pattern: { cmd: string }) =>
          of(
            pattern.cmd === 'integration.geo.region-tree'
              ? regionTree
              : { ok: false },
          ),
      } as never,
      names,
    );
  const admin = (service: CallService | undefined = calls()) =>
    new LeadAdminService(
      db.getRepository(Lead),
      catalogFake as never,
      cards(),
      names,
      service,
    );
  const supervisor = () => new LeadSupervisorService(db, catalogFake as never);

  const addLead = (extra: Partial<Lead> = {}) =>
    db.getRepository(Lead).save(
      db.getRepository(Lead).create({
        source: LeadSource.LANDING,
        streamId: stream.id,
        affiliateId: '77',
        productId: '501',
        name: 'Aziza',
        phoneE164: `+99890${String(1000000 + ++seq)}`,
        regionSoato: '1726',
        districtSoato: '1726266',
        addressLine: 'Turkiston ko‘chasi, 27-uy',
        whereDeliver: CheckoutDeliveryDestination.CENTER,
        salePrice: '262000',
        status: LeadStatus.NEW,
        expiresAt: new Date(NOW.getTime() + 3 * 24 * 60 * MIN),
        ...extra,
      }),
    );
  const addHistory = (
    leadId: string,
    from: LeadStatus | null,
    to: LeadStatus,
    at: Date,
    extra: Partial<LeadHistory> = {},
  ) =>
    db.query(
      `INSERT INTO lead.lead_history (lead_id, from_status, to_status, actor_id, field, old_value, new_value, note, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        leadId,
        from,
        to,
        extra.actorId ?? null,
        extra.field ?? null,
        extra.oldValue ?? null,
        extra.newValue ?? null,
        extra.note ?? null,
        at,
      ],
    );
  const operator = (operatorId: string, state = OperatorWorkState.ONLINE) =>
    db.getRepository(OperatorState).save({
      operatorId,
      state,
      stateSince: new Date(NOW.getTime() - 83 * MIN),
    });
  const addCall = (leadId: string, operatorId: string, extra: Partial<Call>) =>
    db.getRepository(Call).save(
      db.getRepository(Call).create({
        ref: randomUUID(),
        leadId,
        operatorId,
        channel: CallChannel.OFFICE,
        customerPhoneHash: 'x',
        status: CallStatus.REQUESTED,
        requestedAt: new Date(),
        ...extra,
      }),
    );
  const reload = (id: string) => db.getRepository(Lead).findOneByOrFail({ id });
  const ids = (page: { items: Array<{ id: string }> }) =>
    page.items.map((i) => i.id);

  beforeAll(async () => {
    if (!new URL(url!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    lock = new Client({ connectionString: url });
    await lock.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [LEAD_SCHEMA_TEST_LOCK]);
    await lock.query('DROP SCHEMA IF EXISTS lead CASCADE');
    await lock.query('CREATE SCHEMA lead');
    db = await new DataSource({
      type: 'postgres',
      url,
      schema: 'lead',
      entities: LEAD_DB.entities as never,
      migrations: LEAD_DB.migrations as never,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
  });

  beforeEach(async () => {
    await db.query(
      'TRUNCATE lead.call_event, lead.call, lead.operator_phone, lead.lead_attempt, lead.lead_history, lead.fraud_incident, lead.postback_delivery, lead.operator_state, lead.lead, lead.click, lead.stream RESTART IDENTITY CASCADE',
    );
    stream = await db.getRepository(Stream).save({
      code: 'k7m2qa',
      affiliateId: '77',
      productId: '501',
      salePrice: '262000',
    });
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (lock) {
      await lock.query('DROP SCHEMA IF EXISTS lead CASCADE');
      await lock.end();
    }
  });

  it('yorliqlar va sonlar: tekshiruvdagi «Ishda» ga kirmaydi; sonlar filtr bo‘yicha, tab siz; nazoratchiga REVIEW yo‘q', async () => {
    const fresh = await addLead();
    const booked = await addLead({
      status: LeadStatus.BOOKED,
      operatorId: '41',
      bookedUntil: new Date(NOW.getTime() + 5 * MIN),
    });
    const review = await addLead({ reviewReason: LeadReviewReason.IP_RATE });
    const rejected = await addLead({
      status: LeadStatus.REJECTED,
      rejectReason: LeadRejectReason.TOO_EXPENSIVE,
    });
    const merged = await addLead({
      status: LeadStatus.MERGED,
      mergedIntoId: fresh.id,
      reviewReason: LeadReviewReason.IP_RATE,
    });
    await addLead({ status: LeadStatus.CONFIRMED, productId: '502' });

    const all = await admin().list({}, { admin: true }, NOW);
    expect(all.total).toBe(6);
    expect(all.counts).toEqual({
      ALL: 6,
      ACTIVE: 2,
      CONFIRMED: 1,
      REJECTED: 1,
      CLOSED: 1,
      REVIEW: 1,
    });
    const tab = (t: AdminLeadTab, viewer = { admin: true }) =>
      admin().list({ tab: t }, viewer, NOW);
    expect(ids(await tab(AdminLeadTab.ACTIVE)).sort()).toEqual(
      [fresh.id, booked.id].sort(),
    );
    expect(ids(await tab(AdminLeadTab.REVIEW))).toEqual([review.id]);
    expect(ids(await tab(AdminLeadTab.REJECTED))).toEqual([rejected.id]);
    expect(ids(await tab(AdminLeadTab.CLOSED))).toEqual([merged.id]);
    // yorliq tanlansa ham sonlar o‘zgarmaydi; filtr esa ta’sir qiladi
    expect((await tab(AdminLeadTab.REJECTED)).counts.ALL).toBe(6);
    expect(
      (await admin().list({ productId: '502' }, { admin: true }, NOW)).counts,
    ).toMatchObject({ ALL: 1, CONFIRMED: 1, ACTIVE: 0 });
    // har lid bitta yorliqda
    const { ALL, ...rest } = all.counts;
    expect(Object.values(rest).reduce((a, b) => a + b, 0)).toBe(ALL);

    const sup = await admin().list({}, { admin: false }, NOW);
    expect(sup.counts).not.toHaveProperty('REVIEW');
    expect(sup.review).toBeNull();
    await expect(
      tab(AdminLeadTab.REVIEW, { admin: false }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('tekshiruv banneri: eng ko‘p ariza turgan sahifa, vaqt oralig‘i', async () => {
    const other = await db.getRepository(Stream).save({
      code: 'zzzzzz',
      affiliateId: '78',
      productId: '501',
      salePrice: '262000',
    });
    const held = { reviewReason: LeadReviewReason.IP_RATE };
    const a = await addLead(held);
    const b = await addLead(held);
    await addLead({ ...held, streamId: other.id, affiliateId: '78' });
    await db.query(
      `UPDATE lead.lead SET created_at = '2027-01-14T09:20:00Z' WHERE id = $1`,
      [a.id],
    );
    await db.query(
      `UPDATE lead.lead SET created_at = '2027-01-14T09:29:00Z' WHERE id = $1`,
      [b.id],
    );
    expect((await admin().list({}, { admin: true }, NOW)).review).toEqual({
      count: 2,
      streamCode: 'k7m2qa',
      affiliateName: 'Jasur T.',
      from: '2027-01-14T09:20:00.000Z',
      to: '2027-01-14T09:29:00.000Z',
    });
  });

  it('qidiruv: lid raqami, ism, sahifa kodi; «%» va «_» so‘zma-so‘z; telefon bo‘yicha topilmaydi', async () => {
    const aziza = await addLead({ name: 'Aziza 100%' });
    const bobur = await addLead({
      name: 'Bobur',
      streamId: null,
      source: LeadSource.SITE,
    });
    const search = async (text: string) =>
      ids(await admin().list({ search: text }, { admin: true }, NOW));
    expect(await search(`L-${bobur.id}`)).toEqual([bobur.id]);
    expect(await search('aziz')).toEqual([aziza.id]);
    expect(await search('K7M2')).toEqual([aziza.id]);
    expect(await search('100%')).toEqual([aziza.id]);
    expect(await search('%')).toEqual([aziza.id]);
    expect(await search('_')).toEqual([]);
    expect(await search(aziza.phoneE164.slice(4))).toEqual([]);
    expect(await search(aziza.phoneE164)).toEqual([]);
    expect(
      ids(
        await admin().list({ source: LeadSource.SITE }, { admin: true }, NOW),
      ),
    ).toEqual([bobur.id]);
  });

  it('saralash: narx va urinish; sahifalash barqaror', async () => {
    const a = await addLead({ salePrice: '300000', attempts: 2 });
    const b = await addLead({ salePrice: '100000', attempts: 5 });
    const c = await addLead({ salePrice: '200000', attempts: 2 });
    const by = async (sort: AdminLeadSort) =>
      ids(await admin().list({ sort }, { admin: true }, NOW));
    expect(await by(AdminLeadSort.PRICE_ASC)).toEqual([b.id, c.id, a.id]);
    expect(await by(AdminLeadSort.PRICE_DESC)).toEqual([a.id, c.id, b.id]);
    expect(await by(AdminLeadSort.ATTEMPTS_DESC)).toEqual([b.id, c.id, a.id]);
    expect(await by(AdminLeadSort.CREATED_ASC)).toEqual([a.id, b.id, c.id]);
    expect(
      ids(
        await admin().list(
          { sort: AdminLeadSort.ATTEMPTS_DESC, page: 2, limit: 2 },
          { admin: true },
          NOW,
        ),
      ),
    ).toEqual([a.id]);
  });

  it('qator: viloyat, sahifa, narx, urinish, sabab, rad vaqti, qayta qo‘ng‘iroq, navbatdagi o‘rin', async () => {
    const first = await addLead({
      nextAttemptAt: new Date(NOW.getTime() - MIN),
    });
    const second = await addLead({
      nextAttemptAt: new Date(NOW.getTime() - MIN),
    });
    const callback = await addLead({
      status: LeadStatus.CALLBACK,
      operatorId: '41',
      attempts: 1,
      nextAttemptAt: new Date(NOW.getTime() + 42 * MIN),
    });
    const rejected = await addLead({
      status: LeadStatus.REJECTED,
      rejectReason: LeadRejectReason.TOO_EXPENSIVE,
      attempts: 2,
      operatorId: '41',
    });
    const rejectedAt = new Date('2027-01-14T08:02:00.000Z');
    await addHistory(
      rejected.id,
      null,
      LeadStatus.NEW,
      new Date('2027-01-14T07:00:00Z'),
    );
    await addHistory(
      rejected.id,
      LeadStatus.BOOKED,
      LeadStatus.REJECTED,
      rejectedAt,
      { actorId: '41' },
    );
    // manzil tuzatish holatni o‘zgartirmaydi
    await addHistory(
      rejected.id,
      LeadStatus.REJECTED,
      LeadStatus.REJECTED,
      new Date('2027-01-14T08:30:00Z'),
      {
        actorId: '41',
        field: 'address_line',
      },
    );
    const lost = await addLead({ status: LeadStatus.NO_CONTACT, attempts: 6 });
    await addHistory(
      lost.id,
      LeadStatus.CALLBACK,
      LeadStatus.NO_CONTACT,
      new Date('2027-01-13T05:01:00Z'),
    );
    const merged = await addLead({
      status: LeadStatus.MERGED,
      mergedIntoId: first.id,
    });

    const page = await admin().list({}, { admin: true }, NOW);
    const row = (id: string) => page.items.find((i) => i.id === id)!;
    expect(row(rejected.id)).toMatchObject({
      productId: '501',
      productName: 'Simsiz quloqchinlar',
      regionName: 'Toshkent shahri',
      streamCode: 'k7m2qa',
      affiliateName: 'Jasur T.',
      operatorName: 'Dilnoza R.',
      operatorId: '41',
      salePrice: 262000,
      attemptsCount: 2,
      rejectReason: LeadRejectReason.TOO_EXPENSIVE,
      closedNote: 'Qimmat',
      rejectedAt: rejectedAt.toISOString(),
      statusAt: rejectedAt.toISOString(),
      callbackAt: null,
      queuePosition: null,
      inReview: false,
    });
    expect(row(lost.id).closedNote).toBe('6 urinish · 13.01, 10:01');
    expect(row(merged.id).closedNote).toBe(`→ L-${first.id} · asosiy lid`);
    expect(row(callback.id)).toMatchObject({
      callbackAt: new Date(NOW.getTime() + 42 * MIN).toISOString(),
      queuePosition: null, // vaqti kelmagan
      closedNote: null,
      rejectedAt: null,
    });
    // 7-qoida: eng yangi lid birinchi
    expect(row(second.id).queuePosition).toBe(1);
    expect(row(first.id).queuePosition).toBe(2);
    expect(row(first.id).statusAt).toBe(first.createdAt.toISOString());
    expect(JSON.stringify(page)).not.toContain(first.phoneE164);
  });

  it('katalog javob bermasa ro‘yxat nomsiz ochiladi (gateway 10 s kutishiga yetmaydi)', async () => {
    const lead = await addLead();
    catalogFake.list.mockImplementationOnce(() => new Promise(() => undefined));
    const startedAt = Date.now();
    const page = await admin().list({}, { admin: true }, NOW);
    expect(Date.now() - startedAt).toBeLessThan(4_000);
    expect(page.items[0]).toMatchObject({ id: lead.id, productName: '' });
  });

  it('filtr variantlari: lidlardagi mahsulot, operator va sotuvchilar nomi bilan', async () => {
    await addLead();
    await addLead({ productId: '502', operatorId: '41' });
    await operator('42');
    expect(await admin().filterOptions()).toEqual({
      products: [
        { id: '502', name: 'Elektr choynak' },
        { id: '501', name: 'Simsiz quloqchinlar' },
      ],
      operators: [
        { id: '41', name: 'Dilnoza R.' },
        { id: '42', name: 'Umida S.' },
      ],
      affiliates: [{ id: '77', name: 'Jasur T.' }],
    });
  });

  it('bronni bo‘shatish: yangi → navbatga, urinilgan → qayta qo‘ng‘iroq (egasiz), mijoz aytgan — egasida; tarixda sabab', async () => {
    const hold = {
      status: LeadStatus.BOOKED,
      operatorId: '41',
      bookedUntil: new Date(Date.now() + 5 * MIN),
    };
    const fresh = await addLead(hold);
    const tried = await addLead({ ...hold, attempts: 1 });
    const scheduled = await addLead({
      ...hold,
      attempts: 1,
      bookedFromCallback: true,
      nextAttemptAt: new Date(NOW.getTime() - MIN),
    });
    expect(await admin().release('7', fresh.id, ' Kompyuter o‘chdi ')).toEqual({
      leadId: fresh.id,
      status: LeadStatus.NEW,
    });
    expect(await reload(fresh.id)).toMatchObject({
      status: LeadStatus.NEW,
      operatorId: null,
      bookedUntil: null,
    });
    await admin().release('7', tried.id, 'x');
    expect(await reload(tried.id)).toMatchObject({
      status: LeadStatus.CALLBACK,
      operatorId: null,
    });
    await admin().release('7', scheduled.id, 'x');
    expect(await reload(scheduled.id)).toMatchObject({
      status: LeadStatus.CALLBACK,
      operatorId: '41',
      bookedFromCallback: false,
      bookedUntil: null,
    });
    expect(
      await db
        .getRepository(LeadHistory)
        .findOneByOrFail({ leadId: fresh.id, field: 'release' }),
    ).toMatchObject({
      actorId: '7',
      fromStatus: LeadStatus.BOOKED,
      toStatus: LeadStatus.NEW,
      oldValue: { operatorId: '41' },
      newValue: { operatorId: null, reason: 'Kompyuter o‘chdi' },
    });
    await expect(admin().release('7', fresh.id, 'x')).rejects.toMatchObject({
      response: { errorCode: LeadErrorCode.LEAD_NOT_BOOKED },
    });
    await expect(admin().release('7', fresh.id, '  ')).rejects.toMatchObject({
      status: 400,
    });
    await expect(admin().release('7', '999999', 'x')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('suhbat ketayotgan bronni bo‘shatib bo‘lmaydi; operator tugatgach — mumkin', async () => {
    const lead = await addLead({
      status: LeadStatus.BOOKED,
      operatorId: '41',
      bookedUntil: new Date(Date.now() + 5 * MIN),
    });
    const call = await addCall(lead.id, '41', {
      status: CallStatus.CONNECTED,
      answeredAt: new Date(),
    });
    await expect(admin().release('7', lead.id, 'x')).rejects.toMatchObject({
      status: 409,
      response: { errorCode: LeadErrorCode.LEAD_CALL_ACTIVE },
    });
    expect((await reload(lead.id)).status).toBe(LeadStatus.BOOKED);
    await db.getRepository(Call).update(
      { id: call.id },
      {
        endedAt: new Date(),
        status: CallStatus.ENDED,
        endReason: CallEndReason.ANSWERED,
      },
    );
    await expect(admin().release('7', lead.id, 'x')).resolves.toMatchObject({
      status: LeadStatus.NEW,
    });
  });

  it('rejalashtirilgan qo‘ng‘iroqni o‘tkazish: vaqti va holati saqlanadi, egasi almashadi, bron chegarasiga kirmaydi', async () => {
    await operator('42');
    for (let i = 0; i < 5; i++)
      await addLead({
        status: LeadStatus.BOOKED,
        operatorId: '42',
        bookedUntil: new Date(Date.now() + 5 * MIN),
      });
    const at = new Date(NOW.getTime() + 42 * MIN);
    const lead = await addLead({
      status: LeadStatus.CALLBACK,
      operatorId: '41',
      attempts: 1,
      nextAttemptAt: at,
      callbackRemindedAt: NOW,
    });
    expect(
      await supervisor().transfer(
        '7',
        lead.id,
        { operatorId: '42', reason: 'Smenasi tugadi' },
        NOW,
      ),
    ).toMatchObject({ fromOperatorId: '41', toOperatorId: '42' });
    expect(await reload(lead.id)).toMatchObject({
      status: LeadStatus.CALLBACK,
      operatorId: '42',
      nextAttemptAt: at,
      bookedUntil: null,
      callbackRemindedAt: null,
    });
    // ro‘yxatdagi «holat o‘zgardi» vaqti o‘tkazishdan surilmaydi
    const row = (
      await admin().list(
        { operatorId: '42', status: LeadStatus.CALLBACK },
        { admin: true },
        NOW,
      )
    ).items[0];
    expect(row.statusAt).toBe(lead.createdAt.toISOString());
    await expect(
      supervisor().transfer('7', lead.id, { operatorId: '42' }, NOW),
    ).rejects.toMatchObject({
      response: { errorCode: LeadErrorCode.LEAD_NOT_TRANSFERABLE },
    });
    // vaqti kelgan bo‘lsa — avvalgidek bron (chegara to‘lgan → 409)
    await expect(
      supervisor().transfer(
        '7',
        lead.id,
        { operatorId: '42' },
        new Date(at.getTime() + MIN),
      ),
    ).rejects.toMatchObject({
      response: { errorCode: LeadErrorCode.BOOKING_LIMIT_REACHED },
    });
  });

  it('navbat xulosasi: chegara, rejali qo‘ng‘iroqlar, hozirgi faoliyat; telefoniya ulanmagan — activity null', async () => {
    for (const id of ['41', '42', '43', '44']) await operator(id);
    const booked = (operatorId: string) =>
      addLead({
        status: LeadStatus.BOOKED,
        operatorId,
        bookedUntil: new Date(Date.now() + 8 * MIN),
      });
    const talking = await booked('41');
    const answeredAt = new Date(Date.now() - 2 * MIN);
    await addCall(talking.id, '41', {
      status: CallStatus.CONNECTED,
      answeredAt,
    });
    const wrap = await booked('42');
    const endedAt = new Date(Date.now() - 30_000);
    await addCall(wrap.id, '42', {
      status: CallStatus.ENDED,
      requestedAt: new Date(Date.now() - MIN),
      endedAt,
      endReason: CallEndReason.NO_ANSWER,
    });
    const ringing = await booked('43');
    await addCall(ringing.id, '43', { status: CallStatus.RINGING_CUSTOMER });
    // natijasi kiritilgan (urinishga bog‘langan) qo‘ng‘iroq — IDLE
    const done = await booked('44');
    const attempt = await db.getRepository(LeadAttempt).save({
      leadId: done.id,
      operatorId: '44',
      outcome: LeadOutcome.NO_ANSWER,
    });
    await addCall(done.id, '44', {
      status: CallStatus.ENDED,
      endedAt: new Date(),
      endReason: CallEndReason.NO_ANSWER,
      attemptId: attempt.id,
    });
    await addLead({
      status: LeadStatus.CALLBACK,
      operatorId: '41',
      nextAttemptAt: new Date(Date.now() + 60 * MIN),
    });
    const queue = (service: CallService) =>
      new LeadQueueService(
        db,
        {} as never,
        undefined,
        undefined,
        names,
        service,
      ).summary();
    const { operators } = await queue(calls());
    const of_ = (id: string) => operators.find((o) => o.operatorId === id)!;
    expect(of_('41')).toMatchObject({
      name: 'Dilnoza R.',
      activeBookings: 1,
      maxBookings: 5,
      scheduledCalls: 1,
      activity: {
        kind: OperatorActivityKind.IN_CALL,
        leadId: talking.id,
        since: answeredAt.toISOString(),
      },
    });
    expect(of_('42').activity).toEqual({
      kind: OperatorActivityKind.WRAP_UP,
      leadId: wrap.id,
      since: endedAt.toISOString(),
    });
    expect(of_('43').activity).toMatchObject({
      kind: OperatorActivityKind.RINGING,
      leadId: ringing.id,
    });
    expect(of_('44').activity).toEqual({
      kind: OperatorActivityKind.IDLE,
      leadId: null,
      since: null,
    });
    const off = await queue(calls(false));
    expect(off.operators.every((o) => o.activity === null)).toBe(true);
  });

  it('karta: kimda, bron vaqti, manba (IP/qurilma/sub faqat admin), postback, shu raqamdagi lidlar', async () => {
    await operator('41');
    const phone = '+998901119999';
    await addLead({
      phoneE164: phone,
      status: LeadStatus.CONFIRMED,
      productId: '502',
    });
    const lead = await addLead({
      phoneE164: phone,
      status: LeadStatus.BOOKED,
      operatorId: '41',
      bookedUntil: new Date(Date.now() + 8 * MIN),
      sub1: 'fb-reels-1',
      sub3: 'kreativ-4',
      utmSource: 'facebook',
      fbclid: 'abc',
      ip: '198.51.100.23',
      userAgent:
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
      consentAt: new Date('2027-01-14T09:32:00.000Z'),
      consentVersion: '1.0',
    });
    await addHistory(
      lead.id,
      null,
      LeadStatus.NEW,
      new Date('2027-01-14T09:32:00Z'),
    );
    await addHistory(
      lead.id,
      LeadStatus.NEW,
      LeadStatus.BOOKED,
      new Date('2027-01-14T09:36:00Z'),
      { actorId: '41' },
    );
    await db.getRepository(PostbackDelivery).save([
      {
        leadId: lead.id,
        streamId: stream.id,
        event: 'lead',
        attempts: 1,
        responseCode: 200,
        deliveredAt: new Date('2027-01-14T09:32:30Z'),
        nextAttemptAt: null,
      },
      {
        leadId: lead.id,
        streamId: stream.id,
        event: 'confirmed',
        attempts: 5,
        responseCode: 500,
        deliveredAt: null,
        nextAttemptAt: null,
      },
    ]);
    const answeredAt = new Date();
    await addCall(lead.id, '41', { status: CallStatus.CONNECTED, answeredAt });
    const card = await admin().card(lead.id, { admin: true }, NOW);
    expect(card).toMatchObject({
      operator: {
        id: '41',
        name: 'Dilnoza R.',
        state: OperatorWorkState.ONLINE,
        since: new Date(NOW.getTime() - 83 * MIN).toISOString(),
        inCall: true,
        callStartedAt: answeredAt.toISOString(),
      },
      bookedAt: '2027-01-14T09:36:00.000Z',
      closesAt: lead.expiresAt!.toISOString(),
      consentAt: '2027-01-14T09:32:00.000Z',
      rejectedAt: null,
      closedBy: null,
      queuePosition: null,
      sameNumberLeads: 1,
      affiliateName: 'Jasur T.',
      productInfo: {
        category: 'Elektronika',
        weightGrams: 300,
        deliveryMode: 'PARTIAL',
        options: { CENTER: 30000, ADDRESS: 45000 },
      },
      stream: {
        code: 'k7m2qa',
        affiliateId: '77',
        affiliateName: 'Jasur T.',
        sub1: 'fb-reels-1',
        subs: 'sub3=kreativ-4',
        utmSource: 'facebook',
        fbclid: true,
        ip: '198.51.100.23',
        device: 'Android · Chrome',
      },
      postbacks: [
        expect.objectContaining({
          event: 'lead',
          code: 200,
          state: AffiliatePostbackStatus.SENT,
        }),
        expect.objectContaining({
          event: 'confirmed',
          attempt: 5,
          state: AffiliatePostbackStatus.FAILED,
        }),
      ],
      mergedInto: null,
      reopened: null,
      order: null,
    });
    const sup = await admin().card(lead.id, { admin: false }, NOW);
    expect(sup.stream).toMatchObject({
      code: 'k7m2qa',
      ip: null,
      device: null,
      sub1: null,
      subs: null,
    });
    for (const view of [card, sup]) {
      expect(JSON.stringify(view)).not.toContain(phone);
      expect(view).not.toHaveProperty('variant');
    }
  });

  it('karta: rad etgan va yopgan, qayta ochilgan, dublikatning asosiy lidi', async () => {
    const lead = await addLead({
      status: LeadStatus.REJECTED,
      rejectReason: LeadRejectReason.OTHER,
    });
    const at = new Date('2027-01-14T08:02:00.000Z');
    await addHistory(lead.id, LeadStatus.BOOKED, LeadStatus.REJECTED, at, {
      actorId: '41',
    });
    expect(await admin().card(lead.id, { admin: true }, NOW)).toMatchObject({
      rejectedAt: at.toISOString(),
      closedBy: { name: 'Dilnoza R.', at: at.toISOString() },
      operator: null,
      bookedAt: null,
    });
    await admin().reopen('7', lead.id, 'Mijoz qayta qo‘ng‘iroq qildi');
    expect(await admin().card(lead.id, { admin: true })).toMatchObject({
      status: LeadStatus.NEW,
      rejectedAt: null,
      closedBy: null,
      reopened: { by: 'Nodira K.', reason: 'Mijoz qayta qo‘ng‘iroq qildi' },
    });
    const dup = await addLead({
      status: LeadStatus.MERGED,
      mergedIntoId: lead.id,
    });
    await addHistory(dup.id, LeadStatus.NEW, LeadStatus.MERGED, at);
    expect(await admin().card(dup.id, { admin: true }, NOW)).toMatchObject({
      closedBy: { name: 'Tizim' },
      mergedInto: {
        id: lead.id,
        productName: 'Simsiz quloqchinlar',
        status: LeadStatus.NEW,
        streamCode: 'k7m2qa',
        affiliateName: 'Jasur T.',
        operatorName: null,
      },
    });
  });

  describe('LID-5: tekshiruvdagi arizalar bo‘yicha qaror', () => {
    const queued: string[] = [];
    const postbacks: string[] = [];
    const reviewer = () =>
      new LeadAdminService(
        db.getRepository(Lead),
        catalogFake as never,
        cards(),
        names,
        calls(),
        {
          enqueue: async (_m: unknown, lead: Lead, event: string) =>
            postbacks.push(`${lead.id}:${event}`),
        } as never,
        {
          enqueueLead: async (_m: unknown, lead: Lead) => queued.push(lead.id),
        } as never,
        new FraudService(db),
      );
    const held = (extra: Partial<Lead> = {}) =>
      addLead({
        reviewReason: LeadReviewReason.IP_RATE,
        ip: '203.0.113.47',
        nextAttemptAt: new Date(NOW.getTime() - 60 * MIN),
        ...extra,
      });
    beforeEach(async () => {
      queued.length = 0;
      postbacks.length = 0;
    });

    it('navbatga: operatorga beriladi, aloqa oynasi qarordan, «lid» hodisalari endi ketadi, tarix va choralar tarixi', async () => {
      const lead = await held();
      await operator('41');
      const queue = new LeadQueueService(db, {} as never);
      await expect(queue.takeNext('41')).rejects.toMatchObject({ status: 404 });
      const at = new Date();
      expect(
        await reviewer().review(
          '7',
          {
            leadIds: [lead.id],
            decision: LeadReviewDecision.QUEUE,
            reason: ' Boshqa qurilma ',
          },
          at,
        ),
      ).toEqual({
        done: 1,
        items: [
          {
            leadId: lead.id,
            result: LeadReviewResult.DONE,
            status: LeadStatus.NEW,
          },
        ],
      });
      expect(await reload(lead.id)).toMatchObject({
        reviewReason: null,
        nextAttemptAt: at,
        expiresAt: new Date(at.getTime() + 3 * 24 * 60 * MIN),
      });
      expect(postbacks).toEqual([`${lead.id}:lead`]);
      expect(queued).toEqual([lead.id]);
      expect(
        await db
          .getRepository(LeadHistory)
          .findOneByOrFail({ leadId: lead.id, field: 'review' }),
      ).toMatchObject({
        actorId: '7',
        newValue: { decision: 'QUEUE', reason: 'Boshqa qurilma' },
      });
      const [action] = (await new FraudService(db).actions({})).items;
      expect(action).toMatchObject({
        action: FraudActionType.REVIEW_QUEUE,
        target: lead.id,
        actorId: '7',
        reason: 'Boshqa qurilma',
      });
      expect(await queue.takeNext('41')).toBe(lead.id);
    });

    it('spam: «Yaroqsiz», navbatga tushmaydi, yozuv va belgi qoladi; hodisa ketmaydi', async () => {
      const lead = await held();
      const res = await reviewer().review('7', {
        leadIds: [lead.id],
        decision: LeadReviewDecision.SPAM,
        reason: 'Bitta qurilmadan',
      });
      expect(res.done).toBe(1);
      expect(await reload(lead.id)).toMatchObject({
        status: LeadStatus.INVALID,
        reviewReason: LeadReviewReason.IP_RATE,
        nextAttemptAt: null,
      });
      expect(postbacks).toEqual([]);
      expect(queued).toEqual([]);
      const page = await admin().list({}, { admin: true }, NOW);
      expect(page.counts).toMatchObject({ REVIEW: 0, CLOSED: 1 });
    });

    it('har ariza alohida: topilmagan, tekshiruvda emas, faol lidi bor — qolganlari bajariladi; takror — NOT_IN_REVIEW', async () => {
      const phone = '+998907770001';
      const ok = await held();
      const plain = await addLead();
      const blocked = await held({ phoneE164: phone });
      await addLead({ phoneE164: phone }); // shu raqam va mahsulotda faol lid
      const dto = {
        leadIds: [ok.id, plain.id, blocked.id, '999999'],
        decision: LeadReviewDecision.QUEUE,
        reason: 'x',
      };
      const results = (await reviewer().review('7', dto)).items.map(
        (i) => i.result,
      );
      expect(results).toEqual([
        LeadReviewResult.DONE,
        LeadReviewResult.NOT_IN_REVIEW,
        LeadReviewResult.ACTIVE_LEAD_EXISTS,
        LeadReviewResult.NOT_FOUND,
      ]);
      expect((await reload(blocked.id)).reviewReason).toBe(
        LeadReviewReason.IP_RATE,
      );
      expect((await reviewer().review('7', dto)).items[0].result).toBe(
        LeadReviewResult.NOT_IN_REVIEW,
      );
      await expect(
        reviewer().review('7', { ...dto, reason: ' ' }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        reviewer().review('7', { ...dto, decision: 'X' as never }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('bir vaqtda ikki qaror — bittasi qo‘llanadi', async () => {
      const lead = await held();
      const both = await Promise.all(
        [LeadReviewDecision.QUEUE, LeadReviewDecision.SPAM].map((decision) =>
          reviewer().review('7', { leadIds: [lead.id], decision, reason: 'x' }),
        ),
      );
      expect(both.map((r) => r.done).sort()).toEqual([0, 1]);
      expect(
        await db
          .getRepository(LeadHistory)
          .countBy({ leadId: lead.id, field: 'review' }),
      ).toBe(1);
    });

    it('ro‘yxatda IP va qurilma faqat tekshiruvdagi arizada va faqat adminga', async () => {
      const lead = await held({
        userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/131.0 Mobile',
      });
      const plain = await addLead({ ip: '198.51.100.23' });
      const row = (
        page: Awaited<ReturnType<LeadAdminService['list']>>,
        id: string,
      ) => page.items.find((i) => i.id === id)!;
      const page = await admin().list({}, { admin: true }, NOW);
      expect(row(page, lead.id)).toMatchObject({
        ip: '203.0.113.47',
        device: 'Android · Chrome',
      });
      expect(row(page, plain.id)).toMatchObject({ ip: null, device: null });
      const sup = await admin().list({}, { admin: false }, NOW);
      expect(row(sup, lead.id)).toMatchObject({ ip: null, device: null });
    });
  });

  it('CSV: filtr va yorliq ro‘yxatdagidek, so‘ralgan vaqtdan keyingi lid kirmaydi, telefon oxirgi 4, formula himoyasi, bo‘laklar', async () => {
    const a = await addLead({
      name: '=HYPERLINK("x")',
      sub1: 's;1',
      attempts: 2,
    });
    const b = await addLead({
      name: 'Bobur',
      status: LeadStatus.REJECTED,
      rejectReason: LeadRejectReason.OTHER,
      operatorId: '41',
      streamId: null,
      source: LeadSource.SITE,
    });
    await db.query(`UPDATE lead.lead SET created_at = '2027-01-14T09:32:00Z'`);
    const late = await addLead({ name: 'Keyin kelgan' });
    await db.query(
      `UPDATE lead.lead SET created_at = '2027-01-14T10:00:00Z' WHERE id = $1`,
      [late.id],
    );
    const until = NOW.toISOString();
    const columns = Object.values(LeadExportColumn);
    expect(await admin().exportCount({}, NOW)).toEqual({ rows: 2 });
    const chunk = await admin().exportChunk({
      filters: {},
      columns,
      until,
      afterId: null,
    });
    expect(chunk.nextAfterId).toBeNull();
    expect(chunk.lines).toEqual([
      'Lid;Mijoz;Telefon;Sahifa;Narx, so‘m;Operator;Urinish;Holat;Keldi (Toshkent);Sub',
      `L-${b.id};Bobur;****${b.phoneE164.slice(-4)};;262000;Dilnoza R.;0;Rad etildi;14.01.2027 14:32;`,
      `L-${a.id};"'=HYPERLINK(""x"")";****${a.phoneE164.slice(-4)};k7m2qa;262000;;2;Yangi;14.01.2027 14:32;"sub1=s;1"`,
    ]);
    expect(
      (
        await admin().exportChunk({
          filters: { tab: AdminLeadTab.REJECTED },
          columns: [LeadExportColumn.LEAD],
          until,
          afterId: null,
        })
      ).lines,
    ).toEqual(['Lid', `L-${b.id}`]);
    // keyingi bo‘lak sarlavhasiz
    expect(
      (
        await admin().exportChunk({
          filters: {},
          columns: [LeadExportColumn.LEAD],
          until,
          afterId: b.id,
        })
      ).lines,
    ).toEqual([`L-${a.id}`]);
  });
});
