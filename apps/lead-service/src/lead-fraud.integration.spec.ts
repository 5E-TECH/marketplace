import { Client } from 'pg';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  AffiliateStreamStatus,
  CatalogOfferSnapshot,
  CheckoutDeliveryDestination,
  FraudActionType,
  FraudIncidentStatus,
  FraudRule,
  LEAD_EVENTS,
  LeadErrorCode,
  LeadRejectReason,
  LeadReviewReason,
  LeadSource,
  LeadStatus,
  OperatorWorkState,
  OutboxEvent,
  RedListReason,
} from '@app/common';
import {
  LEAD_ENTITIES,
  Lead,
  LeadAttempt,
  LeadHistory,
  OfferContent,
  OperatorState,
  Stream,
} from './entities';
import { FraudService } from './fraud.service';
import { LeadCardService } from './lead-card.service';
import { LeadAddressService } from './lead-address.service';
import { LeadAdminService } from './lead-admin.service';
import { LeadIntakeService } from './lead-intake.service';
import { LeadOutboxRelayService } from './lead-outbox-relay.service';
import { LeadQueueService } from './lead-queue.service';
import { LeadSupervisorService } from './lead-supervisor.service';
import { StreamService } from './stream.service';
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

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
/** lead.integration.spec.ts dagi bilan bir xil: lead sxemasini DROP/CREATE qiladigan spec’lar ketma-ket. */
const LEAD_SCHEMA_TEST_LOCK = 2_304_002;
let schemaLock: Client | undefined;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;
const MIN = 60_000;

/**
 * BE-35 — nazoratchi va firibgarlik (PostgreSQL). Faqat `lead` sxemasiga tegadi; boshqa lead testlari bilan
 * ketma-ket (`--runInBand`).
 */
describeWithPostgres('BE-35 nazoratchi va firibgarlik (PostgreSQL)', () => {
  let db: DataSource;
  let seq = 0;
  let defaultStreamId: string;
  const catalogFake = {
    get: jest.fn(async () => null),
    list: jest.fn(async () => [
      { productId: '501', name: 'Simsiz quloqchinlar' },
    ]),
  };
  const phones = new Map<string, string>();
  const identityFake = {
    phoneOf: jest.fn(async (id: string) => {
      if (id === '666') throw new Error('identity ishlamayapti');
      return phones.get(id) ?? null;
    }),
  };
  const supervisor = () => new LeadSupervisorService(db, catalogFake as never);
  const fraud = () => new FraudService(db, identityFake as never);
  /** Lid `created_at` baza soatida (mikrosoniya) — `now` (millisoniya) undan 1 ms orqada qolib, lid ko‘rinmay qolmasin. */
  const soon = () => new Date(Date.now() + 1_000);
  const admin = () =>
    new LeadAdminService(
      db.getRepository(Lead),
      catalogFake as never,
      {} as never,
    );

  const newStream = (code = 'k7Qm2x', affiliateId = '42') =>
    db.getRepository(Stream).save({
      code,
      affiliateId,
      productId: '501',
      salePrice: '189000',
    });
  const addLead = (extra: Partial<Lead> = {}) =>
    db.getRepository(Lead).save(
      db.getRepository(Lead).create({
        source: LeadSource.LANDING,
        streamId: defaultStreamId,
        affiliateId: '42',
        productId: '501',
        name: 'Aziza',
        phoneE164: `+99890${String(1000000 + ++seq)}`,
        regionSoato: '1726',
        districtSoato: '1726266',
        addressLine: 'Turkiston ko‘chasi, 27-uy',
        whereDeliver: CheckoutDeliveryDestination.CENTER,
        salePrice: '189000',
        status: LeadStatus.NEW,
        ...extra,
      }),
    );
  const setCreated = (id: string, at: Date) =>
    db.query(`UPDATE lead.lead SET created_at = $2 WHERE id = $1`, [id, at]);
  const operator = (operatorId: string, state: OperatorWorkState) =>
    db.getRepository(OperatorState).save({ operatorId, state });
  const outbox = (eventType: string) =>
    db
      .getRepository(OutboxEvent)
      .find({ where: { eventType }, order: { id: 'ASC' } });
  const reload = (id: string) => db.getRepository(Lead).findOneByOrFail({ id });

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
    phones.clear();
    identityFake.phoneOf.mockClear();
    defaultStreamId = (await newStream('dflt01')).id;
  });

  describe('qizil ro‘yxat va qayta taqsimlash (OPR-8)', () => {
    it('TC3: 10 daqiqadan ortiq kutgan yangi lid va vaqti o‘tgan rejalashtirilgan qo‘ng‘iroq; navbatdagi o‘rni', async () => {
      const now = new Date('2027-01-14T09:37:00.000Z');
      const at = (minAgo: number) => new Date(now.getTime() - minAgo * MIN);
      await operator('41', OperatorWorkState.BREAK);
      await operator('43', OperatorWorkState.ONLINE);
      const fresh = await addLead({ nextAttemptAt: at(9) }); // 9 daqiqa — hali emas
      await setCreated(fresh.id, at(9));
      const old = await addLead({ nextAttemptAt: at(39) });
      await setCreated(old.id, at(39));
      const older = await addLead({ nextAttemptAt: at(12) });
      await setCreated(older.id, at(12));
      // Operatorda: vaqti 7 daqiqa oldin o‘tgan (15 daqiqagacha egasida) va 16 daqiqa oldin o‘tgan (navbatga qaytgan)
      const owned = await addLead({
        status: LeadStatus.CALLBACK,
        operatorId: '41',
        nextAttemptAt: at(7),
        attempts: 1,
      });
      const returned = await addLead({
        status: LeadStatus.CALLBACK,
        operatorId: '43',
        nextAttemptAt: at(16),
        attempts: 1,
      });
      // Kirmaydi: avtomatik qayta urinish, tekshiruvdagi, bron, yopilgan
      await addLead({
        status: LeadStatus.CALLBACK,
        nextAttemptAt: at(30),
        attempts: 1,
      });
      const held = await addLead({
        reviewReason: LeadReviewReason.IP_RATE,
        nextAttemptAt: at(50),
      });
      await setCreated(held.id, at(50));
      await addLead({
        status: LeadStatus.BOOKED,
        operatorId: '43',
        bookedUntil: at(-5),
      });
      await addLead({ status: LeadStatus.CONFIRMED });

      const list = await supervisor().redList(now);
      expect(list.items.map((i) => [i.leadId, i.reason])).toEqual([
        [old.id, RedListReason.NEW_WAITING],
        [returned.id, RedListReason.CALLBACK_OVERDUE],
        [older.id, RedListReason.NEW_WAITING],
        [owned.id, RedListReason.CALLBACK_OVERDUE],
      ]);
      expect(list).toMatchObject({ newWaiting: 2, callbackOverdue: 2 });
      const by = Object.fromEntries(list.items.map((i) => [i.leadId, i]));
      // Navbat: avval vaqti kelgan qayta qo‘ng‘iroqlar (avtomatik — 30 daq, qaytgan — 16 daq), keyin eng yangi lid birinchi
      expect(list.queueSize).toBe(5);
      expect(by[returned.id]).toMatchObject({
        queuePosition: 2,
        operatorId: '43',
        returnsToQueueAt: null,
      });
      expect(by[old.id]).toMatchObject({
        queuePosition: 5,
        waitingMinutes: 39,
        productName: 'Simsiz quloqchinlar',
      });
      expect(by[older.id]).toMatchObject({
        queuePosition: 4,
        waitingMinutes: 12,
      });
      expect(by[owned.id]).toMatchObject({
        queuePosition: null,
        operatorId: '41',
        operatorState: OperatorWorkState.BREAK,
        waitingMinutes: 7,
        returnsToQueueAt: new Date(at(7).getTime() + 15 * MIN),
      });
      // Bir daqiqadan keyin 9 daqiqalik lid ham qizil (har daqiqada yangilanadi)
      const later = await supervisor().redList(
        new Date(now.getTime() + 2 * MIN),
      );
      expect(later.items.map((i) => i.leadId)).toContain(fresh.id);
    });

    it('o‘tkazish: faqat «Ishda» operatorga, 5 ta chegara; lid uning bronida, tarixda kim va kimdan kimga; bron tugasa navbatga', async () => {
      const now = new Date();
      await operator('41', OperatorWorkState.OFFLINE);
      await operator('42', OperatorWorkState.BREAK);
      await operator('43', OperatorWorkState.ONLINE);
      await operator('44', OperatorWorkState.ONLINE);
      const lead = await addLead({ nextAttemptAt: now });
      const t = supervisor();
      await expect(
        t.transfer('7', lead.id, { operatorId: '41' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: LeadErrorCode.OPERATOR_OFFLINE },
      });
      await expect(
        t.transfer('7', lead.id, { operatorId: '42' }),
      ).rejects.toMatchObject({
        response: { errorCode: LeadErrorCode.OPERATOR_ON_BREAK },
      });
      for (let i = 0; i < 5; i++)
        await addLead({
          status: LeadStatus.BOOKED,
          operatorId: '44',
          bookedUntil: new Date(now.getTime() + 5 * MIN),
        });
      await expect(
        t.transfer('7', lead.id, { operatorId: '44' }),
      ).rejects.toMatchObject({
        response: { errorCode: LeadErrorCode.BOOKING_LIMIT_REACHED },
      });

      const res = await t.transfer(
        '7',
        lead.id,
        { operatorId: '43', reason: 'Navbatda 39 daqiqa' },
        now,
      );
      expect(res).toMatchObject({
        leadId: lead.id,
        fromOperatorId: null,
        toOperatorId: '43',
        actorId: '7',
      });
      expect(await reload(lead.id)).toMatchObject({
        status: LeadStatus.BOOKED,
        operatorId: '43',
        bookedFromCallback: false,
        bookedUntil: new Date(now.getTime() + 10 * MIN),
      });
      // Boshqa operator bron qilgan lid ham o‘tkaziladi (oflayn bo‘lib qoldi)
      const stuck = await addLead({
        status: LeadStatus.BOOKED,
        operatorId: '41',
        bookedUntil: new Date(now.getTime() + 8 * MIN),
      });
      await expect(
        t.transfer('7', stuck.id, { operatorId: '43' }, now),
      ).resolves.toMatchObject({ fromOperatorId: '41' });
      await expect(
        t.transfer('7', stuck.id, { operatorId: '43' }, now),
      ).rejects.toMatchObject({
        response: { errorCode: LeadErrorCode.LEAD_NOT_TRANSFERABLE },
      });
      const done = await addLead({ status: LeadStatus.CONFIRMED });
      await expect(
        t.transfer('7', done.id, { operatorId: '43' }),
      ).rejects.toMatchObject({
        response: { errorCode: LeadErrorCode.LEAD_NOT_TRANSFERABLE },
      });
      await expect(
        t.transfer('7', '999999', { operatorId: '43' }),
      ).rejects.toMatchObject({ status: 404 });

      const history = await db
        .getRepository(LeadHistory)
        .findOneByOrFail({ leadId: lead.id, field: 'transfer' });
      expect(history).toMatchObject({
        actorId: '7',
        fromStatus: LeadStatus.NEW,
        toStatus: LeadStatus.BOOKED,
        oldValue: { operatorId: null },
        newValue: { operatorId: '43', reason: 'Navbatda 39 daqiqa' },
      });
      const today = await t.transfers(undefined, now);
      expect(today.map((x) => x.leadId).sort()).toEqual(
        [lead.id, stuck.id].sort(),
      );

      // 10 daqiqada natija kiritilmadi — navbatga qaytadi (5-qoida)
      await new LeadQueueService(db, {} as never).sweep(
        new Date(now.getTime() + 11 * MIN),
      );
      expect(await reload(lead.id)).toMatchObject({
        status: LeadStatus.NEW,
        operatorId: null,
      });
    });
  });

  describe('admin «Rad etildi» lidni qayta ochadi', () => {
    it('TC4: sababsiz — 400; sabab bilan — lid navbatda, tarixda admin, vaqt va sabab; faol lid bo‘lsa — 409', async () => {
      const now = new Date();
      const rejected = await addLead({
        status: LeadStatus.REJECTED,
        rejectReason: LeadRejectReason.TOO_EXPENSIVE,
        attempts: 2,
        operatorId: '41',
      });
      await expect(
        admin().reopen('7', rejected.id, '  '),
      ).rejects.toMatchObject({ status: 400 });
      const open = await addLead({ status: LeadStatus.CALLBACK });
      await expect(admin().reopen('7', open.id, 'sabab')).rejects.toMatchObject(
        {
          status: 409,
          response: { errorCode: LeadErrorCode.LEAD_NOT_REJECTED },
        },
      );

      const res = await admin().reopen(
        '7',
        rejected.id,
        'Mijoz o‘zi qo‘ng‘iroq qilib buyurtma bermoqchi',
        now,
      );
      expect(res).toEqual({ leadId: rejected.id, status: LeadStatus.NEW });
      expect(await reload(rejected.id)).toMatchObject({
        status: LeadStatus.NEW,
        attempts: 0,
        operatorId: null,
        rejectReason: null,
        nextAttemptAt: now,
      });
      expect(
        await db
          .getRepository(LeadHistory)
          .findOneByOrFail({ leadId: rejected.id, field: 'reopen' }),
      ).toMatchObject({
        actorId: '7',
        fromStatus: LeadStatus.REJECTED,
        toStatus: LeadStatus.NEW,
        newValue: { reason: 'Mijoz o‘zi qo‘ng‘iroq qilib buyurtma bermoqchi' },
      });

      // Shu raqam va mahsulotda faol lid bor — ikkinchisi ochilmaydi (LID-4)
      const again = await addLead({
        status: LeadStatus.REJECTED,
        rejectReason: LeadRejectReason.OTHER,
        phoneE164: rejected.phoneE164,
      });
      await expect(
        admin().reopen('7', again.id, 'sabab'),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: LeadErrorCode.ACTIVE_LEAD_EXISTS },
      });
    });
  });

  describe('firibgarlik markazi (ADM-4, TZ 7)', () => {
    /** Sahifaga natijasi kiritilgan lidlar: n ta, shundan `invalid` yaroqsiz, `confirmed` tasdiqlangan, qolgani rad. */
    const traffic = async (
      streamId: string,
      n: number,
      invalid: number,
      confirmed: number,
      at: Date,
    ) => {
      const rows: Lead[] = [];
      for (let i = 0; i < n; i++)
        rows.push(
          db.getRepository(Lead).create({
            source: LeadSource.LANDING,
            streamId,
            affiliateId: '42',
            productId: '501',
            name: 'Mijoz',
            phoneE164: `+99891${String(1000000 + ++seq)}`,
            regionSoato: '1726',
            districtSoato: '1726266',
            addressLine: 'Turkiston ko‘chasi, 27-uy',
            whereDeliver: CheckoutDeliveryDestination.CENTER,
            salePrice: '189000',
            attempts: 1,
            status:
              i < invalid
                ? LeadStatus.INVALID
                : i < invalid + confirmed
                  ? LeadStatus.CONFIRMED
                  : LeadStatus.REJECTED,
            rejectReason:
              i >= invalid + confirmed ? LeadRejectReason.NOT_NEEDED : null,
          }),
        );
      const saved = await db.getRepository(Lead).save(rows);
      await db.query(
        `UPDATE lead.lead SET created_at = $2 WHERE id = ANY($1::bigint[])`,
        [saved.map((r) => r.id), at],
      );
    };

    it('TC1: 50 liddan 21 yaroqsiz → hodisa, taklif — ogohlantirish; ogohlantirishdan keyin ham past → to‘xtatish', async () => {
      const t0 = new Date();
      const good = await newStream('good01');
      const bad = await newStream('bad001');
      await traffic(good.id, 50, 20, 10, new Date(t0.getTime() - 60 * MIN)); // aynan 60% — chegara emas
      await traffic(bad.id, 50, 21, 10, new Date(t0.getTime() - 60 * MIN)); // 29/50 = 58%
      await addLead({ streamId: bad.id }); // navbatdagi yangi lid hisobga kirmaydi
      const f = fraud();
      expect(await f.detectQuality(t0)).toBe(1);
      const page = await f.list({ state: 'OPEN' });
      expect(page).toMatchObject({ total: 1, open: 1 });
      expect(page.items[0]).toMatchObject({
        rule: FraudRule.QUALITY,
        streamId: bad.id,
        affiliateId: '42',
        proposedAction: FraudActionType.WARN,
        summary: 'Sahifa bad001: yaroqli lid 58%, tasdiq 34% (50 lid)',
        evidence: {
          leads: 50,
          valid: 29,
          invalid: 21,
          duplicate: 0,
          confirmed: 10,
        },
      });
      // Takror tekshiruv yangi hodisa ochmaydi
      await f.detectQuality(t0);
      expect((await f.list({})).total).toBe(1);

      const id = page.items[0].id;
      const warned = await f.decide(
        '7',
        id,
        { action: FraudActionType.WARN, reason: '51 lid, yaroqli 58%' },
        t0,
      );
      expect(warned).toMatchObject({
        status: FraudIncidentStatus.RESOLVED,
        closedBy: '7',
      });
      expect(warned.actions[0]).toMatchObject({
        action: FraudActionType.WARN,
        targetType: 'STREAM',
        target: bad.id,
        actorId: '7',
      });
      expect(
        (await outbox(LEAD_EVENTS.FRAUD_MEASURE))[0].payload,
      ).toMatchObject({ affiliateId: '42', streamId: bad.id, action: 'WARN' });
      await expect(
        f.decide('7', id, { action: FraudActionType.DISMISS, reason: 'x' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: LeadErrorCode.FRAUD_INCIDENT_CLOSED },
      });

      // Ogohlantirishdan keyin faqat yangi trafik o‘lchanadi
      expect(await f.detectQuality(new Date(t0.getTime() + 60 * MIN))).toBe(0);
      await traffic(bad.id, 50, 5, 5, new Date(t0.getTime() + 10 * MIN)); // tasdiq 5/45 = 11%
      expect(await f.detectQuality(new Date(t0.getTime() + 60 * MIN))).toBe(1);
      const [next] = (await f.list({ state: 'OPEN' })).items;
      expect(next).toMatchObject({
        proposedAction: FraudActionType.STOP_STREAM,
        evidence: { leads: 50, confirmRate: 11 },
      });
      await f.decide('7', next.id, {
        action: FraudActionType.STOP_STREAM,
        reason: 'Ogohlantirishdan keyin ham tasdiq 11%',
      });
      expect(
        await db.getRepository(Stream).findOneByOrFail({ id: bad.id }),
      ).toMatchObject({
        status: AffiliateStreamStatus.STOPPED,
        fraudStoppedAt: expect.any(Date),
      });
      // Sotuvchi bloki olinganda firibgarlik sababli to‘xtagan sahifa qayta ochilmaydi
      const streams = new StreamService(
        db.getRepository(Stream),
        {} as never,
        db.getRepository(Lead),
        {} as never,
        new ConfigService({}),
      );
      await streams.setAffiliateStreamsStatus(
        '42',
        AffiliateStreamStatus.STOPPED,
      );
      await streams.setAffiliateStreamsStatus(
        '42',
        AffiliateStreamStatus.ACTIVE,
      );
      expect(
        (await db.getRepository(Stream).findOneByOrFail({ id: bad.id })).status,
      ).toBe(AffiliateStreamStatus.STOPPED);
      expect(
        (await db.getRepository(Stream).findOneByOrFail({ id: good.id }))
          .status,
      ).toBe(AffiliateStreamStatus.ACTIVE);
      // To‘xtatilgan sahifa endi tekshirilmaydi
      expect(await f.detectQuality(new Date(t0.getTime() + 120 * MIN))).toBe(0);
    });

    it('TC2: sotuvchi o‘z raqamidan → haq ushlandi (hodisa, chora, moliyaga hodisa); qo‘yib yuborish; bloklashda bekor', async () => {
      phones.set('42', '+998 90 123 45 67');
      phones.set('43', '+998931112233');
      const own = await addLead({ phoneE164: '+998901234567' });
      await addLead({ phoneE164: '+998901234567', affiliateId: '43' }); // boshqa sotuvchi — mijoz
      await addLead({ affiliateId: '666', phoneE164: '+998901234567' }); // identity xato — keyingi safar
      const f = fraud();
      expect(await f.detectSelfOrders(soon())).toBe(1);
      expect(await f.detectSelfOrders(soon())).toBe(0); // takror — yangi hodisa yo‘q
      const [incident] = (await f.list({ rule: FraudRule.SELF_ORDER })).items;
      expect(incident).toMatchObject({
        status: FraudIncidentStatus.OPEN,
        leadId: own.id,
        affiliateId: '42',
      });
      const holds = await outbox(LEAD_EVENTS.FRAUD_FEE_HOLD);
      expect(holds).toHaveLength(1);
      expect(holds[0]).toMatchObject({
        aggregateType: 'fraud',
        payload: { affiliateId: '42', leadIds: [own.id] },
      });
      expect(
        await db
          .getRepository(LeadHistory)
          .findOneByOrFail({ leadId: own.id, field: 'fraud' }),
      ).toMatchObject({
        actorId: null,
        note: 'Sotuvchi haqi tekshiruvgacha ushlab turildi (TZ 7)',
      });
      const detail = await f.get(incident.id);
      expect(detail.actions.map((a) => [a.action, a.actorId])).toEqual([
        [FraudActionType.HOLD_FEE, null],
      ]);
      // Takroriy ushlash yangi chora yozmaydi; hodisa ochiq qoladi
      await f.decide('7', incident.id, {
        action: FraudActionType.HOLD_FEE,
        reason: 'tekshiruv',
      });
      expect((await f.get(incident.id)).actions).toHaveLength(1);
      // Haq ushlangan: ogohlantirish hodisani yopmaydi (haq taqdiri hal bo‘lmagan)
      const warned = await f.decide('7', incident.id, {
        action: FraudActionType.WARN,
        reason: 'Birinchi marta — ogohlantirish',
      });
      expect(warned.status).toBe(FraudIncidentStatus.OPEN);
      // Shu lid bo‘yicha boshqa (qo‘lda ochilgan) hodisaning «Asossiz»i bu ushlashni qo‘yib yubormaydi
      const other = await f.create('7', {
        rule: FraudRule.FAKE_CONFIRM,
        leadId: own.id,
        operatorId: '38',
        reason: 'Tasdiq shubhali',
      });
      await expect(
        f.decide('7', other.id, {
          action: FraudActionType.RELEASE_FEE,
          reason: 'x',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { errorCode: LeadErrorCode.FRAUD_ACTION_NOT_APPLICABLE },
      });
      await f.decide('7', other.id, {
        action: FraudActionType.DISMISS,
        reason: 'Asossiz',
      });
      expect(await f.activeHolds(db.manager, { leadId: own.id })).toEqual([
        own.id,
      ]);

      const released = await f.decide('7', incident.id, {
        action: FraudActionType.RELEASE_FEE,
        reason: 'Mijoz — sotuvchining onasi, buyurtma haqiqiy',
      });
      expect(released.status).toBe(FraudIncidentStatus.RESOLVED);
      expect(await outbox(LEAD_EVENTS.FRAUD_FEE_RELEASE)).toHaveLength(1);
      expect(await f.activeHolds(db.manager, { affiliateId: '42' })).toEqual(
        [],
      );

      // Ikkinchi holat: bloklash — sahifalar to‘xtaydi, ushlangan haq bekor
      const stream = await newStream('own002');
      const own2 = await addLead({
        phoneE164: '+998901234567',
        streamId: stream.id,
      });
      expect(await f.detectSelfOrders(soon())).toBe(1);
      const [second] = (await f.list({ state: 'OPEN' })).items;
      const blocked = await f.decide('7', second.id, {
        action: FraudActionType.BLOCK_AFFILIATE,
        reason: 'Uchinchi marta o‘z buyurtmasi',
      });
      expect(blocked.status).toBe(FraudIncidentStatus.RESOLVED);
      const cancel = await outbox(LEAD_EVENTS.FRAUD_FEE_CANCEL);
      expect(cancel[0].payload).toMatchObject({
        affiliateId: '42',
        leadIds: [own2.id],
      });
      expect(
        (await db.getRepository(Stream).findOneByOrFail({ id: stream.id }))
          .status,
      ).toBe(AffiliateStreamStatus.STOPPED);
      expect(await f.activeHolds(db.manager, { affiliateId: '42' })).toEqual(
        [],
      );

      // Relay: fraud.fee.* — moliyaga, fraud.measure.applied — notification ga
      const finance = { emit: jest.fn(() => of(undefined)) };
      const notification = { emit: jest.fn(() => of(undefined)) };
      const relay = new LeadOutboxRelayService(
        db.getRepository(OutboxEvent),
        { emit: jest.fn(() => of(undefined)) } as never,
        notification as never,
        new ConfigService({ LEAD_OUTBOX_RELAY: 'on' }),
        finance as never,
      );
      await relay.relay();
      expect(finance.emit.mock.calls.map((c: unknown[]) => c[0])).toEqual([
        LEAD_EVENTS.FRAUD_FEE_HOLD,
        LEAD_EVENTS.FRAUD_FEE_RELEASE,
        LEAD_EVENTS.FRAUD_FEE_HOLD,
        LEAD_EVENTS.FRAUD_FEE_CANCEL,
      ]);
      expect(notification.emit).toHaveBeenCalledWith(
        LEAD_EVENTS.FRAUD_MEASURE,
        expect.objectContaining({ action: 'BLOCK_AFFILIATE' }),
      );
    });

    it('relay: yo‘nalishi yo‘q hodisalar navbat boshida turib qolsa ham lead.confirmed yuboriladi', async () => {
      const repo = db.getRepository(OutboxEvent);
      const blocked = Array.from({ length: 25 }, (_, i) =>
        repo.create({
          aggregateType: 'fraud',
          aggregateId: String(i + 1),
          eventType: 'fraud.unrouted.test',
          payload: { i },
        }),
      );
      await repo.save(blocked);
      await repo.save(
        repo.create({
          aggregateType: 'lead',
          aggregateId: '1',
          eventType: LEAD_EVENTS.CONFIRMED,
          payload: { leadId: '1' },
        }),
      );
      const checkout = { emit: jest.fn(() => of(undefined)) };
      const relay = new LeadOutboxRelayService(
        repo,
        checkout as never,
        { emit: jest.fn(() => of(undefined)) } as never,
        new ConfigService({ LEAD_OUTBOX_RELAY: 'on' }),
      );
      await expect(relay.relay()).resolves.toBe(1);
      expect(checkout.emit).toHaveBeenCalledWith(LEAD_EVENTS.CONFIRMED, {
        leadId: '1',
      });
    });

    it('qo‘lda hodisa (soxta tasdiq); «Asossiz»; mos kelmagan chora — 400; choralar tarixi o‘chmaydi', async () => {
      const f = fraud();
      await expect(
        f.create('7', { rule: FraudRule.FAKE_CONFIRM, reason: 'x' }),
      ).rejects.toMatchObject({ status: 400 });
      const incident = await f.create('7', {
        rule: FraudRule.FAKE_CONFIRM,
        operatorId: '38',
        reason:
          'Tasdiqlagan 12 buyurtmasidan 9 tasi rad etildi, yozuvlar tinglandi',
      });
      expect(incident).toMatchObject({
        status: FraudIncidentStatus.OPEN,
        detectedBy: '7',
        operatorId: '38',
      });
      await expect(
        f.create('7', {
          rule: FraudRule.FAKE_CONFIRM,
          operatorId: '38',
          reason: 'yana',
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        f.decide('7', incident.id, {
          action: FraudActionType.STOP_STREAM,
          reason: 'x',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { errorCode: LeadErrorCode.FRAUD_ACTION_NOT_APPLICABLE },
      });
      await expect(
        f.decide('7', incident.id, {
          action: FraudActionType.WARN,
          reason: '',
        }),
      ).rejects.toMatchObject({ status: 400 });
      const dismissed = await f.decide('7', incident.id, {
        action: FraudActionType.DISMISS,
        reason: 'Rad sababi — Elchi kechikishi',
      });
      expect(dismissed).toMatchObject({
        status: FraudIncidentStatus.DISMISSED,
      });
      const history = await f.actions({ by: 'ADMIN' });
      expect(history.items[0]).toMatchObject({
        action: FraudActionType.DISMISS,
        targetType: 'OPERATOR',
        target: '38',
      });
      await expect(
        db.query(`UPDATE lead.fraud_action SET reason = 'o‘zgardi'`),
      ).rejects.toThrow(/faqat qo‘shiladi/);
      await expect(db.query(`DELETE FROM lead.fraud_action`)).rejects.toThrow(
        /faqat qo‘shiladi/,
      );
      expect((await f.list({ state: 'CLOSED' })).total).toBe(1);
    });

    describe('lid qabul qilishda (BE-12 bilan)', () => {
      const geo = {
        ok: true,
        regionSoato: '1726',
        regionName: 'Toshkent shahri',
        districtSoato: '1726266',
        districtName: 'Yunusobod tumani',
        elchiRegionId: '1',
        elchiDistrictId: '10',
      };
      const offer = {
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
      } as unknown as CatalogOfferSnapshot;
      const intake = () =>
        new LeadIntakeService(
          db,
          db.getRepository(Stream),
          { get: jest.fn(async () => offer) } as never,
          new LeadAddressService(db, { send: jest.fn(() => of(geo)) } as never),
          new ConfigService({
            LEAD_PHONE_OPERATOR_CODES: '90,91,93,94,95,97,98,99',
          }),
          undefined,
          undefined,
          fraud(),
        );
      const submit = (code: string, phone: string, ip = '203.0.113.7') =>
        intake().create({
          lead: {
            code,
            name: 'Gulchehra',
            phone,
            regionSoato: '1726',
            districtSoato: '1726266',
            addressLine: 'Turkiston ko‘chasi, 27-uy',
            whereDeliver: CheckoutDeliveryDestination.ADDRESS,
            consentVersion: '2026-11-16',
          } as never,
          ip,
          userAgent: 'Mozilla/5.0',
        });

      it('TC6: qora ro‘yxatdagi raqamdan yangi lid → lid tarixida va choralar tarixida (bir marta), kartada belgi', async () => {
        const stream = await db.getRepository(Stream).save({
          code: 'bl0001',
          affiliateId: '77',
          productId: '501',
          salePrice: '262000',
        });
        await addLead({
          status: LeadStatus.REJECTED,
          rejectReason: LeadRejectReason.OTHER,
          phoneE164: '+998977654321',
          productId: '601',
        });
        await addLead({
          status: LeadStatus.REJECTED,
          rejectReason: LeadRejectReason.OTHER,
          phoneE164: '+998977654321',
          productId: '602',
        });
        const res = await submit(stream.code, '+998977654321', '198.51.100.1');
        expect(
          await db
            .getRepository(LeadHistory)
            .findOneByOrFail({ leadId: res.leadId, field: 'blacklist' }),
        ).toMatchObject({ newValue: { rejections: 2 } });
        const card = await new LeadCardService(
          db.getRepository(Lead),
          db.getRepository(LeadAttempt),
          db.getRepository(LeadHistory),
          db.getRepository(OfferContent),
          catalogFake as never,
          { send: jest.fn(() => throwError(() => new Error('yo‘q'))) } as never,
          { send: jest.fn(() => throwError(() => new Error('yo‘q'))) } as never,
        ).build(await reload(res.leadId));
        expect(card.blacklistRejections).toBe(2);
        await submit(stream.code, '+998977654321', '198.51.100.1'); // dublikat ariza
        const actions = await fraud().actions({});
        expect(
          actions.items.filter((a) => a.action === FraudActionType.BLACKLIST),
        ).toHaveLength(1);
        expect(actions.items[0]).toMatchObject({
          targetType: 'PHONE',
          target: '****4321',
          actorId: null,
        });
      });

      it('bir IP dan 10 daqiqada 5 tadan ortiq ariza → «Spam lid» hodisasi va «tekshiruvga olindi» bir marta', async () => {
        const stream = await db.getRepository(Stream).save({
          code: 'sp0001',
          affiliateId: '77',
          productId: '501',
          salePrice: '262000',
        });
        for (let i = 0; i < 7; i++)
          await submit(stream.code, `+99893${String(2000000 + i)}`);
        const page = await fraud().list({ rule: FraudRule.SPAM_IP });
        expect(page.total).toBe(1);
        expect(page.items[0]).toMatchObject({
          status: FraudIncidentStatus.OPEN,
          streamId: stream.id,
          affiliateId: '77',
          evidence: { ip: '203.0.113.7', leadsInWindow: 7, windowMinutes: 10 },
        });
        const actions = await fraud().actions({});
        expect(actions.items.map((a) => a.action)).toEqual([
          FraudActionType.REVIEW_HOLD,
        ]);
      });
    });
  });
});
