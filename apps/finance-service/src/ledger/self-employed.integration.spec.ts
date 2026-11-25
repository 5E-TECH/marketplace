import { Client } from 'pg';
import { DataSource } from 'typeorm';
import {
  ErrorCode,
  openPinfl,
  sealPinfl,
  SelfEmployedReason,
  SelfEmployedSource,
  SelfEmployedStatus,
  WithdrawalBlockReason,
} from '@app/common';
import { FINANCE_DB } from '../database';
import { LedgerService } from './ledger.service';
import { SelfEmployedService } from './self-employed.service';
import { WithdrawalService } from './withdrawal.service';

const url = process.env.FINANCE_TEST_DATABASE_URL;
const describePostgres = url ? describe : describe.skip;
/** finance sxemasi integratsiya testlari ketma-ket (withdrawal.integration.spec bilan bir kalit). */
const FINANCE_SCHEMA_TEST_LOCK = 2_304_001;
const KEY = 'test-self-employed-key-32-characters!!';
const PINFL = '30101195600018';

describePostgres('BE-25 5-tur JShShIR arizasi (PostgreSQL)', () => {
  let lock: Client;
  let ds: DataSource;
  let svc: SelfEmployedService;
  let withdrawals: WithdrawalService;
  let seq = 100;

  const config = (key: string | undefined = KEY) =>
    ({
      get: (name: string) =>
        name === 'SELF_EMPLOYED_SECRET_KEY' ? key : undefined,
    }) as never;
  const id = () => String(++seq);
  const submit = async (
    affiliateId: string,
    { pinfl = PINFL, ...over }: Record<string, unknown> = {},
  ) =>
    (
      await svc.submit({
        affiliateId,
        pinflSealed: sealPinfl(String(pinfl), KEY),
        fullName: 'Sevara Yusupova',
        document: null,
        ...over,
      })
    ).info;
  const last = async (affiliateId: string) =>
    (
      (await ds.query(
        `SELECT id::text FROM finance.self_employed_application WHERE affiliate_id = $1 ORDER BY id DESC LIMIT 1`,
        [affiliateId],
      )) as Array<{ id: string }>
    )[0].id;
  const approve = async (affiliateId: string, name = 'Sevara Yusupova') =>
    svc.approve({
      id: await last(affiliateId),
      reviewerId: '7',
      currentFullName: name,
    });
  const gate = async (affiliateId: string) =>
    (await withdrawals.balance({ affiliateId })).selfEmployed;

  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_finance_test'))
      throw new Error(
        'FINANCE_TEST_DATABASE_URL nomi _finance_test bilan tugashi kerak',
      );
    lock = new Client({ connectionString: url });
    await lock.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [FINANCE_SCHEMA_TEST_LOCK]);
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query('DROP SCHEMA IF EXISTS finance CASCADE');
    await admin.query('CREATE SCHEMA finance');
    await admin.end();
    ds = await new DataSource({
      type: 'postgres',
      url,
      schema: 'finance',
      migrations: FINANCE_DB.migrations,
      migrationsRun: true,
      synchronize: false,
    }).initialize();
    svc = new SelfEmployedService(ds, config());
    withdrawals = new WithdrawalService(ds, new LedgerService(ds));
  }, 60_000);

  afterAll(async () => {
    await ds?.destroy();
    await lock?.end();
  });

  it('yuborilmagan → tekshirilmoqda → tasdiq: pul yechish ochiladi; javobda faqat oxirgi 4 raqam', async () => {
    const a = id();
    expect(await svc.current({ affiliateId: a })).toEqual({
      status: SelfEmployedStatus.NOT_SUBMITTED,
      pinflLast4: null,
      activity: null,
      submittedAt: null,
      checkedAt: null,
      reason: null,
      comment: null,
      documentName: null,
    });
    const info = await submit(a, {
      document: {
        objectKey: `private/affiliate/${a}/0f0e8f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6.pdf`,
        fileName: 'maqom-malumotnoma.pdf',
        contentType: 'application/pdf',
        size: 1200,
      },
    });
    expect(info).toMatchObject({
      status: SelfEmployedStatus.PENDING,
      pinflLast4: '0018',
      activity: 'SMM va internet-marketing',
      checkedAt: null,
      documentName: 'maqom-malumotnoma.pdf',
    });
    expect(JSON.stringify(info)).not.toContain(PINFL);
    expect((await withdrawals.balance({ affiliateId: a })).blockReason).toBe(
      WithdrawalBlockReason.NOT_SELF_EMPLOYED,
    );
    const done = await approve(a);
    expect(done).toMatchObject({
      status: SelfEmployedStatus.VERIFIED,
      checkedBy: '7',
      current: true,
    });
    expect(JSON.stringify(done)).not.toContain(PINFL);
    expect(await gate(a)).toBe(true);
    expect((await svc.current({ affiliateId: a })).checkedAt).not.toBeNull();
    expect(await svc.documentMine({ affiliateId: a })).toMatchObject({
      fileName: 'maqom-malumotnoma.pdf',
    });
  });

  it('JShShIR bazada ochiq emas; moliya to‘liq raqamni ocha oladi', async () => {
    const a = id();
    await submit(a);
    const [row] = (await ds.query(
      `SELECT to_jsonb(s)::text AS j FROM finance.self_employed_application s WHERE affiliate_id = $1`,
      [a],
    )) as Array<{ j: string }>;
    expect(row.j).not.toContain(PINFL);
    expect(row.j).toContain('0018');
    const { pinflSealed } = await svc.reveal({ id: await last(a) });
    expect(pinflSealed).not.toContain(PINFL);
    expect(openPinfl(pinflSealed, KEY)).toBe(PINFL);
    expect(openPinfl(pinflSealed, `${KEY}2`)).toBeNull();
  });

  it('kalit yo‘q yoki qisqa — ariza qabul qilinmaydi (ochiq saqlanmaydi)', async () => {
    const a = id();
    for (const key of ['', 'qisqa'])
      await expect(
        new SelfEmployedService(ds, config(key)).submit({
          affiliateId: a,
          pinflSealed: sealPinfl(PINFL, KEY),
          fullName: 'A B',
          document: null,
        }),
      ).rejects.toMatchObject({ status: 503 });
    for (const key of ['', 'qisqa'])
      await expect(
        new SelfEmployedService(ds, config(key)).check({
          affiliateId: a,
          fullName: 'A B',
        }),
      ).rejects.toMatchObject({ status: 503 });
    // servislarda kalit har xil — saqlanmaydi, raqam xabarda yo‘q
    const other = await svc
      .submit({
        affiliateId: a,
        pinflSealed: sealPinfl(PINFL, `${KEY}-boshqa`),
        fullName: 'A B',
        document: null,
      })
      .catch((e: unknown) => e);
    expect(other).toMatchObject({ status: 503 });
    expect(JSON.stringify(other)).not.toContain(PINFL);
    expect((await svc.current({ affiliateId: a })).status).toBe(
      SelfEmployedStatus.NOT_SUBMITTED,
    );
  });

  it('noto‘g‘ri JShShIR, ismsiz profil, boshqa sotuvchi fayli — rad; xabarda raqam yo‘q', async () => {
    const a = id();
    for (const pinfl of ['3010119560001', '3010119560001x']) {
      const error = await submit(a, { pinfl }).catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 503 });
      expect(JSON.stringify(error)).not.toContain(pinfl);
    }
    await expect(submit(a, { fullName: '  ' })).rejects.toMatchObject({
      response: { errorCode: ErrorCode.PROFILE_NAME_REQUIRED },
    });
    await expect(
      submit(a, {
        document: {
          objectKey: 'private/affiliate/999/x.pdf',
          fileName: 'x',
          contentType: 'application/pdf',
          size: 1,
        },
      }),
    ).rejects.toMatchObject({
      response: { errorCode: ErrorCode.DOCUMENT_NOT_FOUND },
    });
  });

  it('tekshirilayotganda va tasdiqlangandan keyin qayta yuborilmaydi; parallel ikki yuborishdan bittasi o‘tadi', async () => {
    const a = id();
    expect(await svc.check({ affiliateId: a, fullName: 'A B' })).toEqual({
      ok: true,
    });
    await expect(
      svc.check({ affiliateId: a, fullName: ' ' }),
    ).rejects.toMatchObject({
      response: { errorCode: ErrorCode.PROFILE_NAME_REQUIRED },
    });
    const results = await Promise.allSettled([submit(a), submit(a), submit(a)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(submit(a)).rejects.toMatchObject({
      response: { errorCode: ErrorCode.ALREADY_PENDING },
    });
    await expect(
      svc.check({ affiliateId: a, fullName: 'A B' }),
    ).rejects.toMatchObject({
      response: { errorCode: ErrorCode.ALREADY_PENDING },
    });
    await approve(a);
    await expect(submit(a)).rejects.toMatchObject({
      response: { errorCode: ErrorCode.ALREADY_VERIFIED },
    });
  });

  it('rad: sabab va izoh sotuvchiga; qayta yuboriladi; tarix qoladi', async () => {
    const a = id();
    await submit(a);
    const first = await last(a);
    await expect(
      svc.reject({ id: first, reviewerId: '7' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.reject({
        id: first,
        reviewerId: '7',
        reason: SelfEmployedReason.NAME_CHANGED,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await svc.reject({
      id: first,
      reviewerId: '7',
      reason: SelfEmployedReason.ACTIVITY_MISMATCH,
      comment: ' Hujjatda boshqa faoliyat turi. ',
    });
    expect(await svc.current({ affiliateId: a })).toMatchObject({
      status: SelfEmployedStatus.REJECTED,
      reason: 'Faoliyat turi 34-band emas',
      comment: 'Hujjatda boshqa faoliyat turi.',
    });
    expect(await gate(a)).toBe(false);
    await submit(a);
    expect(await svc.current({ affiliateId: a })).toMatchObject({
      status: SelfEmployedStatus.PENDING,
      reason: null,
      comment: null,
    });
    // eskisi bilan qaror qilib bo‘lmaydi
    await expect(
      svc.approve({
        id: first,
        reviewerId: '7',
        currentFullName: 'Sevara Yusupova',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(svc.reveal({ id: first })).rejects.toMatchObject({
      status: 409,
    });
    expect((await svc.get({ id: first })).current).toBe(false);
  });

  it('bekor qilish: pul yechish yopiladi, sotuvchi qayta yuboradi', async () => {
    const a = id();
    await submit(a);
    await expect(
      svc.revoke({
        id: await last(a),
        reviewerId: '7',
        reason: SelfEmployedReason.STATUS_INACTIVE,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await approve(a);
    expect(await gate(a)).toBe(true);
    await svc.revoke({
      id: await last(a),
      reviewerId: '7',
      reason: SelfEmployedReason.STATUS_INACTIVE,
    });
    expect(await gate(a)).toBe(false);
    expect(await svc.current({ affiliateId: a })).toMatchObject({
      status: SelfEmployedStatus.REVOKED,
      reason: 'Maqom faol emas',
    });
    await submit(a);
    expect((await svc.current({ affiliateId: a })).status).toBe(
      SelfEmployedStatus.PENDING,
    );
  });

  describe('ism-familiya o‘zgarishi', () => {
    it('tasdiqlangan maqom: yangi ism bilan qayta tekshiruv, pul yechish yopiladi; o‘sha ism — o‘zgarmaydi', async () => {
      const a = id();
      await submit(a);
      await approve(a);
      expect(
        await svc.rename({ affiliateId: a, fullName: ' Sevara   Yusupova ' }),
      ).toMatchObject({ recheck: false });
      expect(await gate(a)).toBe(true);
      expect(
        await svc.rename({ affiliateId: a, fullName: 'Sevara Karimova' }),
      ).toMatchObject({
        recheck: true,
        info: { status: SelfEmployedStatus.PENDING },
      });
      expect(await gate(a)).toBe(false);
      const row = await svc.get({ id: await last(a) });
      expect(row).toMatchObject({
        status: SelfEmployedStatus.PENDING,
        source: SelfEmployedSource.NAME_CHANGE,
        fullName: 'Sevara Karimova',
        pinflLast4: '0018',
      });
      // ism hali yangilanmagan (yoki yana o‘zgargan) bo‘lsa tasdiqlanmaydi
      await expect(approve(a, 'Sevara Yusupova')).rejects.toMatchObject({
        response: { errorCode: ErrorCode.NAME_CHANGED },
      });
      await approve(a, 'Sevara Karimova');
      expect(await gate(a)).toBe(true);
    });

    it('navbatdagi ariza: eskisi eskiradi, navbatdagi joyi saqlanadi', async () => {
      const a = id();
      await submit(a);
      const first = await last(a);
      const before = await svc.get({ id: first });
      await svc.rename({ affiliateId: a, fullName: 'Sevara Karimova' });
      expect((await svc.get({ id: first })).status).toBe('SUPERSEDED');
      const after = await svc.get({ id: await last(a) });
      expect(after.id).not.toBe(first);
      expect(after.submittedAt).toBe(before.submittedAt);
      await expect(
        svc.approve({
          id: first,
          reviewerId: '7',
          currentFullName: 'Sevara Yusupova',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('yuborilmagan, rad etilgan — o‘zgarmaydi; qo‘lda tasdiqlangani — bekor, JShShIR so‘raladi', async () => {
      const a = id();
      expect(
        await svc.rename({ affiliateId: a, fullName: 'A B' }),
      ).toMatchObject({ recheck: false });
      await svc.setManually({
        affiliateId: a,
        selfEmployed: true,
        updatedBy: '7',
        fullName: 'A B',
      });
      expect(await gate(a)).toBe(true);
      await svc.rename({ affiliateId: a, fullName: 'A C' });
      expect(await gate(a)).toBe(false);
      expect(await svc.current({ affiliateId: a })).toMatchObject({
        status: SelfEmployedStatus.REVOKED,
        reason: 'F.I.Sh. o‘zgardi — JShShIR ni qayta yuboring',
      });
      expect(
        await svc.rename({ affiliateId: a, fullName: 'A D' }),
      ).toMatchObject({ recheck: false });
    });
  });

  it('eski versiya qo‘ygan arizasiz darvoza: ism o‘zgarsa yopiladi', async () => {
    const a = id();
    await ds.query(
      `INSERT INTO finance.affiliate_payout_profile (affiliate_id, self_employed, updated_by) VALUES ($1, true, '7')`,
      [a],
    );
    expect(await svc.rename({ affiliateId: a, fullName: 'A B' })).toMatchObject(
      {
        recheck: true,
        info: { status: SelfEmployedStatus.NOT_SUBMITTED },
      },
    );
    expect(await gate(a)).toBe(false);
  });

  it('qo‘lda belgi va ism: qo‘lda tasdiqlangani yangi ism bilan qayta belgilanadi, arizalisi — NAME_CHANGED', async () => {
    const [a, b] = [id(), id()];
    const set = (affiliateId: string, fullName: string) =>
      svc.setManually({
        affiliateId,
        selfEmployed: true,
        updatedBy: '7',
        fullName,
      });
    await set(a, '');
    await set(a, 'Anvar J');
    expect((await svc.get({ id: await last(a) })).fullName).toBe('Anvar J');
    expect(
      await svc.rename({ affiliateId: a, fullName: 'Anvar J' }),
    ).toMatchObject({ recheck: false });
    await submit(b);
    await approve(b);
    await expect(set(b, 'Boshqa Ism')).rejects.toMatchObject({
      response: { errorCode: ErrorCode.NAME_CHANGED },
    });
    await set(b, 'Sevara Yusupova');
    expect(await gate(b)).toBe(true);
  });

  it('qo‘lda belgi: ochiq ariza bo‘lsa 409; olib tashlansa bekor; takror — o‘zgarmaydi', async () => {
    const a = id();
    const set = (selfEmployed: boolean) =>
      svc.setManually({
        affiliateId: a,
        selfEmployed,
        updatedBy: '7',
        fullName: 'Sevara Yusupova',
      });
    await submit(a);
    await expect(set(true)).rejects.toMatchObject({
      response: { errorCode: ErrorCode.ALREADY_PENDING },
    });
    await approve(a);
    await set(true);
    expect((await svc.current({ affiliateId: a })).pinflLast4).toBe('0018');
    await set(false);
    expect((await svc.current({ affiliateId: a })).status).toBe(
      SelfEmployedStatus.REVOKED,
    );
    await set(true);
    expect(await svc.current({ affiliateId: a })).toMatchObject({
      status: SelfEmployedStatus.VERIFIED,
      pinflLast4: null,
    });
    await expect(svc.reveal({ id: await last(a) })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('bir JShShIR ikki sotuvchida — ogohlantirish; rad etilgani hisobga olinmaydi', async () => {
    const [a, b, c] = [id(), id(), id()];
    const pinfl = '41212199000011';
    for (const x of [a, b, c]) await submit(x, { pinfl });
    await svc.reject({
      id: await last(c),
      reviewerId: '7',
      reason: SelfEmployedReason.PINFL_NOT_FOUND,
    });
    expect(
      (await svc.get({ id: await last(a) })).samePinflAffiliateIds,
    ).toEqual([b]);
  });

  it('ro‘yxat: har sotuvchining oxirgisi, navbat eskisi tepada, sonlar', async () => {
    await ds.query('TRUNCATE finance.self_employed_application');
    const [a, b, c] = [id(), id(), id()];
    for (const x of [a, b, c]) await submit(x);
    await approve(c);
    await svc.rename({ affiliateId: a, fullName: 'Sevara Karimova' });
    const page = await svc.list({
      query: { status: SelfEmployedStatus.PENDING },
    });
    expect(page.items.map((i) => i.affiliateId)).toEqual([a, b]);
    expect(page).toMatchObject({
      total: 2,
      counts: { PENDING: 2, VERIFIED: 1, REJECTED: 0, REVOKED: 0 },
    });
    const all = await svc.list({ query: { page: 2, limit: 2 } });
    expect(all.total).toBe(3);
    expect(all.items.map((i) => i.affiliateId)).toEqual([c]);
    expect(JSON.stringify(page)).not.toContain(PINFL);
  });

  it('migratsiya: eski qo‘lda belgilar ko‘chadi, down jadvalni o‘chiradi, up qayta ishlaydi', async () => {
    const runner = ds.createQueryRunner();
    const migration = FINANCE_DB.migrations.find(
      (m) => (m as { name: string }).name === 'CreateSelfEmployed1798761600000',
    ) as unknown as new () => {
      up(r: unknown): Promise<void>;
      down(r: unknown): Promise<void>;
    };
    const step = new migration();
    await step.down(runner);
    await ds.query(
      `INSERT INTO finance.affiliate_payout_profile (affiliate_id, self_employed, updated_by)
       VALUES ('9001', true, '7'), ('9002', false, '7')
       ON CONFLICT (affiliate_id) DO UPDATE SET self_employed = EXCLUDED.self_employed`,
    );
    await step.up(runner);
    expect(await svc.current({ affiliateId: '9001' })).toMatchObject({
      status: SelfEmployedStatus.VERIFIED,
      pinflLast4: null,
    });
    expect((await svc.current({ affiliateId: '9002' })).status).toBe(
      SelfEmployedStatus.NOT_SUBMITTED,
    );
    await runner.release();
  });
});
