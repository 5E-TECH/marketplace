import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  CallChannel,
  CallEndReason,
  CallErrorCode,
  CallRecordingState,
  CallStatus,
  CheckoutDeliveryDestination,
  LeadOutcome,
  LeadSource,
  LeadStatus,
  OperatorPhoneKind,
  OperatorWorkState,
  RecordingMode,
  Role,
} from '@app/common';
import { LEAD_DB } from '../database';
import {
  Call,
  Lead,
  LeadAttempt,
  LeadHistory,
  OfferContent,
  Stream,
} from '../entities';
import { LeadAddressService } from '../lead-address.service';
import { Telephony1798675200000 } from '../migrations/1798675200000-telephony';
import { LeadCardService } from '../lead-card.service';
import { LeadQueueService } from '../lead-queue.service';
import { OperatorWorkplaceService } from '../operator-workplace.service';
import { UserNamesClient } from '../user-names.client';
import { CallService } from './call.service';
import { TelephonyProvider } from './telephony.provider';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
/** lead sxemasini qayta yaratadigan spec’lar ketma-ket (lead.integration.spec.ts dagi qulf). */
const LEAD_SCHEMA_TEST_LOCK = 2_304_002;
const OPERATOR = '41';
const OTHER = '42';
const PHONE = '+998901234567';
const DAY = 86_400_000;

type Mode = 'ok' | 'reject' | 'error' | 'hang';

/** BE-15 haqiqiy PostgreSQL va HTTP provayder stubi bilan. */
describeWithPostgres('BE-15 telefoniya (PostgreSQL)', () => {
  let lock: Client | undefined;
  let db: DataSource;
  let server: Server;
  let providerUrl: string;
  let mode: Mode = 'ok';
  let seq = 0;
  let streamId: string;
  const requests: Array<{
    path: string;
    auth: string | undefined;
    body: Record<string, unknown>;
  }> = [];

  const config = (over: Record<string, unknown> = {}) =>
    new ConfigService({
      TELEPHONY_API_URL: providerUrl,
      TELEPHONY_API_TOKEN: 'provider-token',
      TELEPHONY_CALLER_ID: '+998712000000',
      TELEPHONY_RECORDING_GRACE_MINUTES: 30,
      INTEGRATION_CREDENTIAL_SECRET: 'isolated-test-secret-0001',
      ...over,
    });
  const names = new UserNamesClient({
    send: () =>
      of([{ id: OPERATOR, name: 'Dilnoza R.', role: Role.OPERATOR_LEAD }]),
  } as never);
  const calls = (over: Record<string, unknown> = {}) => {
    const c = config(over);
    return new CallService(db, new TelephonyProvider(c), c, names);
  };
  const queue = (service: CallService | undefined = calls()) =>
    new LeadQueueService(
      db,
      new LeadAddressService(db, { send: () => of({ ok: true }) } as never),
      undefined,
      undefined,
      undefined,
      service,
    );
  /** Hech kim tinglamayotgan manzil. */
  const closedUrl = async () => {
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const { port } = probe.address() as AddressInfo;
    await new Promise((r) => probe.close(r));
    return `http://127.0.0.1:${port}`;
  };
  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => resolve(body));
    });

  const booked = (extra: Partial<Lead> = {}) =>
    db.getRepository(Lead).save(
      db.getRepository(Lead).create({
        source: LeadSource.LANDING,
        streamId,
        affiliateId: '77',
        productId: '501',
        name: 'Aziza',
        phoneE164: PHONE,
        regionSoato: '1726',
        districtSoato: '1726266',
        addressLine: 'Turkiston ko‘chasi, 27-uy',
        whereDeliver: CheckoutDeliveryDestination.CENTER,
        salePrice: '189000',
        status: LeadStatus.BOOKED,
        operatorId: OPERATOR,
        bookedUntil: new Date(Date.now() + 10 * 60_000),
        expiresAt: new Date(Date.now() + 3 * DAY),
        consentAt: new Date(),
        consentVersion: '1.0',
        ...extra,
      }),
    );
  const refOf = async (id: string) =>
    (await db.getRepository(Call).findOneByOrFail({ id })).ref;
  const completed = async (
    callId: string,
    endReason: CallEndReason,
    extra: { answeredAt?: string; durationSeconds?: number; at?: string } = {},
    service = calls(),
  ) =>
    service.onCompleted({
      eventId: `c-${randomUUID()}`,
      callRef: await refOf(callId),
      at: extra.at ?? new Date().toISOString(),
      endReason,
      answeredAt: extra.answeredAt ?? null,
      durationSeconds: extra.durationSeconds ?? null,
    });
  const recording = async (callId: string, ref = 'rec-1') =>
    calls().onRecordingReady({
      eventId: `r-${randomUUID()}`,
      callRef: await refOf(callId),
      at: new Date().toISOString(),
      recordingRef: ref,
    });

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
    server = createServer((req, res) => {
      void read(req).then((body) => {
        requests.push({
          path: String(req.url),
          auth: req.headers.authorization,
          body: JSON.parse(body || '{}') as Record<string, unknown>,
        });
        if (mode === 'hang') return; // javob yo‘q
        res.statusCode = mode === 'reject' ? 422 : mode === 'error' ? 503 : 201;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ providerCallId: `p-${requests.length}` }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    providerUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  beforeEach(async () => {
    mode = 'ok';
    requests.length = 0;
    await db.query(
      'TRUNCATE lead.call_event, lead.call, lead.operator_phone, lead.lead_attempt, lead.lead_history, lead.operator_state, lead.lead, lead.stream RESTART IDENTITY CASCADE',
    );
    streamId = (
      await db.getRepository(Stream).save({
        code: `c${String(++seq).padStart(5, '0')}`,
        affiliateId: '77',
        productId: '501',
        salePrice: '189000',
      })
    ).id;
    await calls().setPhone(
      OPERATOR,
      { kind: OperatorPhoneKind.EXTENSION, value: '101' },
      '3',
    );
  });

  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((resolve) =>
      server ? server.close(resolve) : resolve(0),
    );
    if (db?.isInitialized) {
      await db.query('DROP SCHEMA IF EXISTS lead CASCADE');
      await db.destroy();
    }
    await lock?.end();
  });

  describe('TC1: qo‘ng‘iroqni boshlash (OPR-6, TEL-1, TEL-2)', () => {
    it('avval operator telefoni, keyin mijoz; mahalliy +998 raqam; mijoz raqami javobda va bazada yo‘q', async () => {
      const lead = await booked();
      const before = Date.now();
      const call = await calls().start(OPERATOR, lead.id);
      expect(Date.now() - before).toBeLessThan(3_000);
      expect(requests).toEqual([
        {
          path: '/calls',
          auth: 'Bearer provider-token',
          body: {
            callRef: await refOf(call.id),
            operator: { kind: 'EXTENSION', value: '101' },
            customer: PHONE,
            callerId: '+998712000000',
            announceRecording: true, // TEL-5
          },
        },
      ]);
      expect(call).toMatchObject({
        leadId: lead.id,
        operatorId: OPERATOR,
        operatorName: 'Dilnoza R.',
        customerName: 'Aziza',
        status: CallStatus.REQUESTED,
        channel: CallChannel.OFFICE,
        suggestedOutcome: null,
        recording: CallRecordingState.NONE,
      });
      expect(JSON.stringify(call)).not.toContain('901234567');
      const row = await db.getRepository(Call).findOneByOrFail({ id: call.id });
      expect(row.providerCallId).toBe('p-1');
      expect(row.customerPhoneHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain('901234567');
    });

    it('masofaviy operator (DZ-11): mobil raqam — qayta qo‘ng‘iroq ko‘prigi', async () => {
      await calls().setPhone(
        OPERATOR,
        { kind: OperatorPhoneKind.MOBILE, value: '+998 90 777-11-22' },
        '3',
      );
      const call = await calls().start(OPERATOR, (await booked()).id);
      expect(call.channel).toBe(CallChannel.APP_BRIDGE);
      expect(requests[0].body.operator).toEqual({
        kind: 'MOBILE',
        value: '+998907771122',
      });
    });

    it('boshqa operatorning lidi, navbatdagi lid — 404; telefon biriktirilmagan — 409; telefoniya ulanmagan — 503', async () => {
      const lead = await booked();
      await expect(calls().start(OTHER, lead.id)).rejects.toMatchObject({
        status: 404,
      });
      const queued = await booked({
        status: LeadStatus.NEW,
        operatorId: null,
        bookedUntil: null,
        phoneE164: '+998901110000',
      });
      await expect(calls().start(OPERATOR, queued.id)).rejects.toMatchObject({
        status: 404,
      });
      // bron muddati o‘tgan (hali supurilmagan) va navbatda eskirgan so‘rov — qo‘ng‘iroq qilinmaydi
      const expired = await booked({
        bookedUntil: new Date(Date.now() - 1_000),
        phoneE164: '+998901110011',
      });
      await expect(calls().start(OPERATOR, expired.id)).rejects.toMatchObject({
        status: 404,
      });
      for (const at of [new Date(Date.now() - 10_500), new Date('x')])
        await expect(
          calls().start(OPERATOR, lead.id, at),
        ).rejects.toMatchObject({
          status: 409,
          response: { errorCode: CallErrorCode.CALL_REQUEST_EXPIRED },
        });
      await calls().deletePhone(OPERATOR);
      await expect(calls().start(OPERATOR, lead.id)).rejects.toMatchObject({
        status: 409,
        response: { errorCode: CallErrorCode.OPERATOR_PHONE_MISSING },
      });
      await expect(
        calls({ TELEPHONY_API_URL: '' }).start(OPERATOR, lead.id),
      ).rejects.toMatchObject({
        status: 503,
        response: { errorCode: CallErrorCode.TELEPHONY_NOT_CONFIGURED },
      });
      expect(requests).toEqual([]);
    });

    it('tugamagan qo‘ng‘iroq bor — 409 (parallel ikki bosishda ham bitta); tugatilgach yangisi boshlanadi', async () => {
      const lead = await booked();
      const results = await Promise.allSettled([
        calls().start(OPERATOR, lead.id),
        calls().start(OPERATOR, lead.id),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: {
          status: 409,
          response: { errorCode: CallErrorCode.CALL_ACTIVE },
        },
      });
      const [{ id }] = await db.getRepository(Call).find();
      await calls().hangup(OPERATOR, id);
      expect(requests.at(-1)!.path).toBe(`/calls/${await refOf(id)}/hangup`);
      await expect(calls().start(OPERATOR, lead.id)).resolves.toMatchObject({
        status: CallStatus.REQUESTED,
      });
      // tugatish so‘ralganining `completed` hodisasi keyin kelsa ham yoziladi
      await completed(id, CallEndReason.CANCELLED);
      await expect(calls().get(OPERATOR, id)).resolves.toMatchObject({
        status: CallStatus.ENDED,
        endReason: CallEndReason.CANCELLED,
      });
    });

    it('provayder rad etdi (4xx) — 502, qo‘ng‘iroq FAILED va yangisini boshlash mumkin', async () => {
      const lead = await booked();
      mode = 'reject';
      await expect(calls().start(OPERATOR, lead.id)).rejects.toMatchObject({
        status: 502,
        response: { errorCode: CallErrorCode.TELEPHONY_FAILED },
      });
      const [failed] = await db.getRepository(Call).find();
      expect(failed).toMatchObject({
        status: CallStatus.FAILED,
        endReason: CallEndReason.FAILED,
        failure: 'provayder HTTP 422',
      });
      // ulanib bo‘lmadi — qo‘ng‘iroq aniq boshlanmagan, operator bloklanmaydi
      await expect(
        calls({ TELEPHONY_API_URL: await closedUrl() }).start(
          OPERATOR,
          lead.id,
        ),
      ).rejects.toMatchObject({ status: 502 });
      mode = 'ok';
      await expect(calls().start(OPERATOR, lead.id)).resolves.toBeDefined();
    });

    it('natija noma’lum (5xx yoki 3 soniyada javob yo‘q) — qo‘ng‘iroq yo‘qotilmaydi: hodisa kelsa davom etadi', async () => {
      const lead = await booked();
      mode = 'error';
      const unknown = await calls().start(OPERATOR, lead.id);
      expect(unknown.status).toBe(CallStatus.REQUESTED);
      await completed(unknown.id, CallEndReason.BUSY);
      await expect(calls().get(OPERATOR, unknown.id)).resolves.toMatchObject({
        status: CallStatus.ENDED,
        suggestedOutcome: LeadOutcome.BUSY,
      });
      mode = 'hang';
      const before = Date.now();
      const slow = await calls().start(OPERATOR, lead.id);
      expect(Date.now() - before).toBeLessThan(4_000);
      expect(slow.status).toBe(CallStatus.REQUESTED);
    }, 10_000);
  });

  describe('TC2, TC3: hodisalar va natija (TEL-3, TEL-4)', () => {
    it('TC2: suhbat tugadi → urinishda boshlanish, davomiylik va yozuv; karta va «Mening urinishlarim»da', async () => {
      const lead = await booked();
      const service = calls();
      const call = await service.start(OPERATOR, lead.id);
      const ref = await refOf(call.id);
      const status = (
        eventId: string,
        value:
          | CallStatus.RINGING_OPERATOR
          | CallStatus.RINGING_CUSTOMER
          | CallStatus.CONNECTED,
        at: string,
      ) => service.onStatus({ eventId, callRef: ref, at, status: value });
      await status('e1', CallStatus.RINGING_OPERATOR, '2026-12-01T09:00:01Z');
      await status('e3', CallStatus.CONNECTED, '2026-12-01T09:00:20Z');
      // kechikkan va takroriy hodisa holatni orqaga qaytarmaydi
      await status('e2', CallStatus.RINGING_CUSTOMER, '2026-12-01T09:00:05Z');
      await status('e3', CallStatus.CONNECTED, '2026-12-01T10:00:00Z');
      await expect(service.get(OPERATOR, call.id)).resolves.toMatchObject({
        status: CallStatus.CONNECTED,
        answeredAt: '2026-12-01T09:00:20.000Z',
      });
      await recording(call.id, 'rec-77'); // yozuv `completed` dan oldin ham kelishi mumkin
      await service.onCompleted({
        eventId: 'e4',
        callRef: ref,
        at: '2026-12-01T09:02:18Z',
        endReason: CallEndReason.ANSWERED,
        answeredAt: '2026-12-01T09:00:20Z',
        durationSeconds: 118,
      });
      const accepted = await queue(service).submitResult(OPERATOR, lead.id, {
        outcome: LeadOutcome.THINKING,
      });
      expect(accepted.status).toBe(LeadStatus.CALLBACK);
      const [attempt] = await db.getRepository(LeadAttempt).find();
      expect(attempt.callId).toBe(call.id);
      const view = {
        id: call.id,
        startedAt: call.requestedAt,
        answered: true,
        durationSeconds: 118,
        recording: CallRecordingState.READY,
      };
      const card = await new LeadCardService(
        db.getRepository(Lead),
        db.getRepository(LeadAttempt),
        db.getRepository(LeadHistory),
        db.getRepository(OfferContent),
        { get: async () => null, list: async () => [] } as never,
        { send: () => of({ deliveryFee: 30_000 }) } as never,
        { send: () => of({ ok: false }) } as never,
        names,
        service,
      ).build(await db.getRepository(Lead).findOneByOrFail({ id: lead.id }));
      expect(card.attempts[0]).toMatchObject({
        operatorName: 'Dilnoza R.',
        call: view,
      });
      const mine = await new OperatorWorkplaceService(
        db,
        { list: async () => [] } as never,
        undefined,
        service,
      ).attempts(OPERATOR);
      expect(mine.items[0]).toMatchObject({ durationSeconds: 118, call: view });
      await expect(service.get(OPERATOR, call.id)).resolves.toMatchObject({
        attemptId: attempt.id,
      });
    });

    it.each([
      [CallEndReason.NO_ANSWER, LeadOutcome.NO_ANSWER],
      [CallEndReason.BUSY, LeadOutcome.BUSY],
      [CallEndReason.UNREACHABLE, LeadOutcome.PHONE_OFF],
    ])(
      'TC3: %s → natija avtomatik taklif: %s; operator tasdiqlaydi',
      async (reason, outcome) => {
        const lead = await booked();
        const call = await calls().start(OPERATOR, lead.id);
        await completed(call.id, reason);
        await expect(calls().get(OPERATOR, call.id)).resolves.toMatchObject({
          suggestedOutcome: outcome,
          durationSeconds: null,
          recording: CallRecordingState.NONE,
        });
        // boshqasini qo‘lda kiritib bo‘lmaydi (TEL-4)
        const wrong =
          outcome === LeadOutcome.BUSY
            ? LeadOutcome.NO_ANSWER
            : LeadOutcome.BUSY;
        await expect(
          queue().submitResult(OPERATOR, lead.id, { outcome: wrong }),
        ).rejects.toMatchObject({
          status: 409,
          response: { errorCode: CallErrorCode.CALL_OUTCOME_MISMATCH },
        });
        await expect(
          queue().submitResult(OPERATOR, lead.id, { outcome }),
        ).resolves.toMatchObject({ status: LeadStatus.CALLBACK });
      },
    );

    it('TEL-4: qo‘ng‘iroqsiz, tugamagan yoki suhbatli qo‘ng‘iroqda «javob bermadi» kiritilmaydi; rad etish natijasiz lid o‘zgarmaydi', async () => {
      const lead = await booked();
      const submit = (outcome: LeadOutcome) =>
        queue().submitResult(OPERATOR, lead.id, { outcome });
      await expect(submit(LeadOutcome.NO_ANSWER)).rejects.toMatchObject({
        response: { errorCode: CallErrorCode.CALL_REQUIRED },
      });
      const call = await calls().start(OPERATOR, lead.id);
      await expect(submit(LeadOutcome.NO_ANSWER)).rejects.toMatchObject({
        response: { errorCode: CallErrorCode.CALL_ACTIVE },
      });
      await completed(call.id, CallEndReason.ANSWERED, {
        answeredAt: new Date().toISOString(),
        durationSeconds: 5,
      });
      await expect(submit(LeadOutcome.PHONE_OFF)).rejects.toMatchObject({
        response: { errorCode: CallErrorCode.CALL_OUTCOME_MISMATCH },
      });
      expect(await db.getRepository(LeadAttempt).count()).toBe(0);
      expect(
        (await db.getRepository(Lead).findOneByOrFail({ id: lead.id })).status,
      ).toBe(LeadStatus.BOOKED);
      // qayta qo‘ng‘iroq — oxirgisining holati hisoblanadi
      const second = await calls().start(OPERATOR, lead.id);
      await completed(second.id, CallEndReason.NO_ANSWER);
      await submit(LeadOutcome.NO_ANSWER);
      const [attempt] = await db.getRepository(LeadAttempt).find();
      expect(attempt.callId).toBe(second.id);
      const linked = await db
        .getRepository(Call)
        .find({ where: { attemptId: attempt.id } });
      expect(linked.map((c) => c.id).sort()).toEqual(
        [call.id, second.id].sort(),
      );
    });

    it('oldingi bron (10 daqiqalik oynadan oldin) va boshqa operator qo‘ng‘irog‘i dalil emas', async () => {
      const lead = await booked();
      const old = await calls().start(OPERATOR, lead.id);
      await completed(old.id, CallEndReason.NO_ANSWER);
      const submit = () =>
        queue().submitResult(OPERATOR, lead.id, {
          outcome: LeadOutcome.NO_ANSWER,
        });
      const required = {
        response: { errorCode: CallErrorCode.CALL_REQUIRED },
      };
      // bron boshlangan vaqtdan bir soniya oldin
      await db.query(
        `UPDATE lead.call SET requested_at = l.booked_until - interval '10 minutes 1 second'
           FROM lead.lead l WHERE l.id = lead_id AND lead.call.id = $1`,
        [old.id],
      );
      await expect(submit()).rejects.toMatchObject(required);
      // shu bron ichida, lekin boshqa operatorniki
      await db.query(
        `UPDATE lead.call SET requested_at = now(), operator_id = $2 WHERE id = $1`,
        [old.id, OTHER],
      );
      await expect(submit()).rejects.toMatchObject(required);
      // bron boshlangan vaqtda — dalil
      await db.query(
        `UPDATE lead.call SET requested_at = l.booked_until - interval '10 minutes', operator_id = $2
           FROM lead.lead l WHERE l.id = lead_id AND lead.call.id = $1`,
        [old.id, OPERATOR],
      );
      await expect(submit()).resolves.toBeDefined();
    });

    it('urinishda oxirgi suhbat ko‘rinadi; boshlanmagan, operator olmagan yoki to‘xtatilgan qo‘ng‘iroq mijoz holatini bildirmaydi', async () => {
      const lead = await booked();
      const talk = await calls().start(OPERATOR, lead.id);
      await completed(talk.id, CallEndReason.ANSWERED, {
        answeredAt: new Date().toISOString(),
        durationSeconds: 118,
      });
      mode = 'reject';
      await calls()
        .start(OPERATOR, lead.id)
        .catch(() => undefined);
      mode = 'ok';
      await queue().submitResult(OPERATOR, lead.id, {
        outcome: LeadOutcome.THINKING,
      });
      const [attempt] = await db.getRepository(LeadAttempt).find();
      expect(attempt.callId).toBe(talk.id);

      const second = await booked({ phoneE164: '+998901110009' });
      const missed = await calls().start(OPERATOR, second.id);
      await completed(missed.id, CallEndReason.NO_ANSWER);
      for (const reason of [
        CallEndReason.OPERATOR_NO_ANSWER,
        CallEndReason.CANCELLED,
      ]) {
        const redial = await calls().start(OPERATOR, second.id);
        await completed(redial.id, reason);
      }
      await expect(
        queue().submitResult(OPERATOR, second.id, {
          outcome: LeadOutcome.NO_ANSWER,
        }),
      ).resolves.toBeDefined();
      const attempts = await db
        .getRepository(LeadAttempt)
        .find({ where: { leadId: second.id } });
      expect(attempts[0].callId).toBe(missed.id);
    });

    it('takroriy `eventId` ikkinchi marta ishlanmaydi (bosqich oldinga bo‘lsa ham)', async () => {
      const call = await calls().start(OPERATOR, (await booked()).id);
      const event = {
        eventId: 'dup',
        callRef: await refOf(call.id),
        at: new Date().toISOString(),
      };
      await calls().onStatus({ ...event, status: CallStatus.RINGING_OPERATOR });
      await calls().onStatus({ ...event, status: CallStatus.CONNECTED });
      await expect(calls().get(OPERATOR, call.id)).resolves.toMatchObject({
        status: CallStatus.RINGING_OPERATOR,
        answeredAt: null,
      });
    });

    it('suhbat ketayotganda bron tugasa lid navbatga qaytmaydi; tugagach qaytadi; telefoniyasiz avvalgidek', async () => {
      const lead = await booked();
      const plain = await booked({ phoneE164: '+998901110010' });
      const call = await calls().start(OPERATOR, lead.id);
      await db.query(
        `UPDATE lead.lead SET booked_until = now() - interval '1 minute'`,
      );
      const status = async (id: string) =>
        (await db.getRepository(Lead).findOneByOrFail({ id })).status;
      expect((await queue().sweep()).released).toBe(1);
      expect(await status(plain.id)).toBe(LeadStatus.NEW);
      expect(await status(lead.id)).toBe(LeadStatus.BOOKED);
      await completed(call.id, CallEndReason.ANSWERED, {
        answeredAt: new Date().toISOString(),
        durationSeconds: 60,
      });
      expect((await queue().sweep()).released).toBe(1);
      expect(await status(lead.id)).toBe(LeadStatus.NEW);
    });

    it('lid boshqa operatorga o‘tkazilsa ham mijoz bilan suhbat tugamaguncha ikkinchi qo‘ng‘iroq yo‘q', async () => {
      await calls().setPhone(
        OTHER,
        { kind: OperatorPhoneKind.EXTENSION, value: '102' },
        '3',
      );
      const lead = await booked();
      const first = await calls().start(OPERATOR, lead.id);
      await db.query(`UPDATE lead.lead SET operator_id = $1`, [OTHER]);
      await expect(calls().start(OTHER, lead.id)).rejects.toMatchObject({
        status: 409,
        response: { errorCode: CallErrorCode.CALL_ACTIVE },
      });
      await completed(first.id, CallEndReason.BUSY);
      await expect(calls().start(OTHER, lead.id)).resolves.toBeDefined();
    });

    it('telefoniya ulanmagan yoki operatorda telefon yo‘q — natija avvalgidek qo‘lda (BE-13)', async () => {
      const first = await booked();
      await expect(
        queue(calls({ TELEPHONY_API_URL: '' })).submitResult(
          OPERATOR,
          first.id,
          { outcome: LeadOutcome.NO_ANSWER },
        ),
      ).resolves.toMatchObject({ status: LeadStatus.CALLBACK });
      await calls().deletePhone(OPERATOR);
      const second = await booked({ phoneE164: '+998901110001' });
      await expect(
        queue().submitResult(OPERATOR, second.id, {
          outcome: LeadOutcome.PHONE_OFF,
        }),
      ).resolves.toMatchObject({ status: LeadStatus.CALLBACK });
      const third = await booked({ phoneE164: '+998901110002' });
      await expect(
        new LeadQueueService(db, {} as never).submitResult(OPERATOR, third.id, {
          outcome: LeadOutcome.BUSY,
        }),
      ).resolves.toBeDefined();
    });

    it('`callEnabled`: telefoniya ulangan va telefon biriktirilgan bo‘lsagina', async () => {
      const state = (service?: CallService, operator = OPERATOR) =>
        queue(service).setState(operator, OperatorWorkState.ONLINE);
      expect((await state(calls())).callEnabled).toBe(true);
      expect((await state(calls(), OTHER)).callEnabled).toBe(false);
      expect((await state(calls({ TELEPHONY_API_URL: '' }))).callEnabled).toBe(
        false,
      );
    });

    it('suhbat bo‘lgan, lekin tugash sababi «javob bermadi» — suhbat hisoblanadi; davomiylik berilmasa vaqtdan; noma’lum qo‘ng‘iroq e’tiborsiz', async () => {
      const call = await calls().start(OPERATOR, (await booked()).id);
      await calls().onStatus({
        eventId: 's-1',
        callRef: await refOf(call.id),
        at: '2026-12-01T09:00:00Z',
        status: CallStatus.CONNECTED,
      });
      await completed(call.id, CallEndReason.NO_ANSWER, {
        at: '2026-12-01T09:00:42Z',
      });
      await expect(calls().get(OPERATOR, call.id)).resolves.toMatchObject({
        endReason: CallEndReason.ANSWERED,
        durationSeconds: 42,
        suggestedOutcome: null,
      });
      // tugagan qo‘ng‘iroq o‘zgarmaydi
      await completed(call.id, CallEndReason.BUSY);
      await expect(calls().get(OPERATOR, call.id)).resolves.toMatchObject({
        endReason: CallEndReason.ANSWERED,
      });
      await expect(
        calls().onCompleted({
          eventId: 'x',
          callRef: randomUUID(),
          at: new Date().toISOString(),
          endReason: CallEndReason.BUSY,
          answeredAt: null,
          durationSeconds: null,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('TC4: tinglash huquqi (TEL-7)', () => {
    it('operator — faqat o‘ziniki; nazoratchi va admin — hammasi; yuklab olish — admin va superadmin; boshqa rollar — yo‘q', async () => {
      const call = await calls().start(OPERATOR, (await booked()).id);
      await completed(call.id, CallEndReason.ANSWERED, {
        answeredAt: new Date().toISOString(),
        durationSeconds: 30,
      });
      await recording(call.id, 'rec-9');
      const access = async (
        userId: string,
        role: Role,
        mode = RecordingMode.LISTEN,
      ) => {
        const result = await calls().recordingAccess({
          callId: call.id,
          userId,
          role,
          mode,
        });
        return result.allowed ? 'ok' : result.reason;
      };
      expect(await access(OPERATOR, Role.OPERATOR_LEAD)).toBe('ok');
      expect(await access(OTHER, Role.OPERATOR_LEAD)).toBe('NOT_OWNER');
      expect(await access('50', Role.SUPERVISOR)).toBe('ok');
      expect(await access('3', Role.ADMIN)).toBe('ok');
      expect(await access('1', Role.SUPERADMIN)).toBe('ok');
      const D = RecordingMode.DOWNLOAD;
      expect(await access(OPERATOR, Role.OPERATOR_LEAD, D)).toBe(
        'DOWNLOAD_FORBIDDEN',
      );
      expect(await access('50', Role.SUPERVISOR, D)).toBe('DOWNLOAD_FORBIDDEN');
      expect(await access('3', Role.ADMIN, D)).toBe('ok');
      expect(await access('1', Role.SUPERADMIN, D)).toBe('ok');
      for (const role of [
        Role.AFFILIATE,
        Role.WHOLESALER,
        Role.WAREHOUSE,
        Role.FINANCE,
      ])
        expect(await access(OPERATOR, role)).toBe('ROLE');
      await expect(calls().recordingRef(call.id)).resolves.toEqual({
        recordingRef: 'rec-9',
      });
    });

    it('yozuv hali yo‘q — 404 RECORDING_NOT_READY; ruxsatsizga avval rad (yozuv bor-yo‘qligi bilinmaydi); boshqa operator qo‘ng‘irog‘i — 404', async () => {
      const call = await calls().start(OPERATOR, (await booked()).id);
      const input = { callId: call.id, mode: RecordingMode.LISTEN };
      await expect(
        calls().recordingAccess({
          ...input,
          userId: OPERATOR,
          role: Role.OPERATOR_LEAD,
        }),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: CallErrorCode.RECORDING_NOT_READY },
      });
      await expect(
        calls().recordingAccess({
          ...input,
          userId: OTHER,
          role: Role.OPERATOR_LEAD,
        }),
      ).resolves.toMatchObject({ allowed: false, reason: 'NOT_OWNER' });
      await expect(calls().get(OTHER, call.id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(calls().hangup(OTHER, call.id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(calls().recordingRef(call.id)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('TC5: yozuvsiz qo‘ng‘iroq hisobotda xato (TEL-3)', () => {
    it('holatlar: javobsiz — NONE, suhbatda — LIVE, kutilmoqda — PENDING, kelmadi — MISSING, bor — READY; son va filtrlar', async () => {
      const service = calls();
      const make = async (operator = OPERATOR) => {
        const lead = await booked({
          operatorId: operator,
          phoneE164: `+99890${String(2_000_000 + ++seq)}`,
        });
        return service.start(operator, lead.id);
      };
      await service.setPhone(
        OTHER,
        { kind: OperatorPhoneKind.EXTENSION, value: '102' },
        '3',
      );
      const ended = async (minutesAgo: number, operator = OPERATOR) => {
        const call = await make(operator);
        const at = new Date(Date.now() - minutesAgo * 60_000);
        await completed(call.id, CallEndReason.ANSWERED, {
          at: at.toISOString(),
          answeredAt: new Date(at.getTime() - 60_000).toISOString(),
          durationSeconds: 60,
        });
        return call.id;
      };
      const none = await make();
      await completed(none.id, CallEndReason.NO_ANSWER);
      const pending = await ended(29);
      const missing = await ended(31);
      const ready = await ended(120);
      await recording(ready);
      const missingOther = await ended(45, OTHER);
      const live = await make();
      await service.onStatus({
        eventId: 'live',
        callRef: await refOf(live.id),
        at: new Date().toISOString(),
        status: CallStatus.CONNECTED,
      });
      const page = await service.list({ limit: 100 });
      expect(
        Object.fromEntries(page.items.map((c) => [c.id, c.recording])),
      ).toEqual({
        [none.id]: 'NONE',
        [pending]: 'PENDING',
        [missing]: 'MISSING',
        [ready]: 'READY',
        [missingOther]: 'MISSING',
        [live.id]: 'LIVE',
      });
      expect(page).toMatchObject({ total: 6, missingRecordings: 2 });
      const errors = await service.list({
        recording: CallRecordingState.MISSING,
        operatorId: OPERATOR,
      });
      expect(errors.items.map((c) => c.id)).toEqual([missing]);
      expect(errors).toMatchObject({ total: 1, missingRecordings: 1 });
      // son yozuv filtriga bog‘liq emas
      expect(
        await service.list({ recording: CallRecordingState.READY }),
      ).toMatchObject({ total: 1, missingRecordings: 2 });
      const second = await service.list({ page: 2, limit: 4 });
      expect(second.items).toHaveLength(2);
      const today = new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Tashkent',
      });
      expect((await service.list({ from: today, to: today })).total).toBe(6);
      expect((await service.list({ to: '2026-01-01' })).total).toBe(0);
      expect((await service.list({ leadId: page.items[0].leadId })).total).toBe(
        1,
      );
      await expect(
        service.list({ from: '2026-12-02', to: '2026-12-01' }),
      ).rejects.toMatchObject({ status: 400 });
      // muddat sozlamadan (30 daqiqa [taklif])
      expect(
        (await calls({ TELEPHONY_RECORDING_GRACE_MINUTES: 10 }).list({}))
          .missingRecordings,
      ).toBe(3);
    });

    it('hech qanday hodisa kelmagan qo‘ng‘iroq (webhook ishlamayapti) — muddatdan keyin hisobotda xato', async () => {
      const call = await calls().start(OPERATOR, (await booked()).id);
      const state = async () =>
        (await calls().get(OPERATOR, call.id)).recording;
      expect(await state()).toBe('NONE');
      await db.query(
        `UPDATE lead.call SET requested_at = now() - interval '31 minutes' WHERE id = $1`,
        [call.id],
      );
      expect(await state()).toBe('MISSING');
      expect((await calls().list({})).missingRecordings).toBe(1);
      await completed(call.id, CallEndReason.NO_ANSWER);
      expect(await state()).toBe('NONE');
    });

    it('tugash hodisasi yo‘qolgan: tugatish so‘ralganidan keyin ham yozuv kutiladi, keyin xato', async () => {
      const call = await calls().start(OPERATOR, (await booked()).id);
      await calls().onStatus({
        eventId: 'lost',
        callRef: await refOf(call.id),
        at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        status: CallStatus.CONNECTED,
      });
      expect((await calls().get(OPERATOR, call.id)).recording).toBe('LIVE');
      await calls().hangup(OPERATOR, call.id);
      expect((await calls().get(OPERATOR, call.id)).recording).toBe('PENDING');
      await db.query(
        `UPDATE lead.call SET hangup_requested_at = now() - interval '31 minutes' WHERE id = $1`,
        [call.id],
      );
      expect((await calls().get(OPERATOR, call.id)).recording).toBe('MISSING');
    });
  });

  it('operator telefoni: format, takror — 409, almashtirish, o‘chirish', async () => {
    const service = calls();
    const set = (operator: string, kind: OperatorPhoneKind, value: string) =>
      service.setPhone(operator, { kind, value }, '3');
    for (const [kind, value] of [
      [OperatorPhoneKind.EXTENSION, '1'],
      [OperatorPhoneKind.EXTENSION, '12a'],
      [OperatorPhoneKind.MOBILE, '101'],
      [OperatorPhoneKind.MOBILE, '+79001234567'],
    ] as const)
      await expect(set(OTHER, kind, value)).rejects.toMatchObject({
        status: 400,
      });
    await expect(
      set(OTHER, OperatorPhoneKind.EXTENSION, '101'),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      set(OPERATOR, OperatorPhoneKind.EXTENSION, '105'),
    ).resolves.toMatchObject({ value: '105', updatedBy: '3' });
    await expect(
      set(OTHER, OperatorPhoneKind.EXTENSION, '101'),
    ).resolves.toMatchObject({ operatorId: OTHER });
    await expect(service.deletePhone(OTHER)).resolves.toEqual({
      deleted: true,
    });
    await expect(service.phone(OTHER)).resolves.toBeNull();
    await expect(service.deletePhone(OTHER)).resolves.toEqual({
      deleted: false,
    });
  });

  it('migratsiya qaytariladi', async () => {
    const migration = new Telephony1798675200000();
    const runner = db.createQueryRunner();
    await migration.down(runner);
    expect(await runner.hasTable('lead.call')).toBe(false);
    await migration.up(runner);
    expect(await runner.hasTable('lead.call')).toBe(true);
    await runner.release();
  });
});
