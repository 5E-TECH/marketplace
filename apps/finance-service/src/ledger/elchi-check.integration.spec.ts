import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Client } from 'pg';
import { of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  ELCHI_CHECK_MISMATCH_EVENT,
  ELCHI_CHECK_RPC,
  ElchiCheckItemState,
  ElchiCheckParcel,
  ElchiCheckReason as R,
  ElchiShipmentStatus,
  LEADER_LOCK_CLASS,
  LeadOrderStatus as S,
} from '@app/common';
import { CreateFinanceTables1724673600000 } from '../migrations/1724673600000-create-finance-tables';
import { CreateCodReconciliation1724932800000 } from '../migrations/1724932800000-create-cod-reconciliation';
import { CreatePayoutSchedule1727568000000 } from '../migrations/1727568000000-create-payout-schedule';
import { CreateLedger1795478400000 } from '../migrations/1795478400000-create-ledger';
import { AddJournalLeadIndex1795564800000 } from '../migrations/1795564800000-add-journal-lead-index';
import { CreateWithdrawal1795651200000 } from '../migrations/1795651200000-create-withdrawal';
import { CreateWholesalerSettlement1795737600000 } from '../migrations/1795737600000-create-wholesaler-settlement';
import { CreateFeeHold1795824000000 } from '../migrations/1795824000000-create-fee-hold';
import { AddRemittanceResolution1796860800000 } from '../migrations/1796860800000-add-remittance-resolution';
import { CreateElchiCheck1797638400000 } from '../migrations/1797638400000-create-elchi-check';
import { CreateReturnPending1799193600000 } from '../migrations/1799193600000-create-return-pending';
import { ElchiCheckService } from './elchi-check.service';
import { LedgerService } from './ledger.service';
import { orderEvent } from './order-events.samples';

const url = process.env.FINANCE_TEST_DATABASE_URL;
const describePostgres = url ? describe : describe.skip;
const FINANCE_SCHEMA_TEST_LOCK = 2_304_001;
let schemaLock: Client | undefined;

/** Namuna buyurtma (order-events.samples): COD 291 000, Elchi haqi 40 000, bizga 251 000. */
const COD = 291_000;
const PAID = {
  collectedFromCustomer: COD,
  elchiFee: 40_000,
  marketPaidAmount: 251_000,
};

const parcel = (orderId: string, status: S): ElchiCheckParcel => ({
  orderId,
  orderNumber: `L-${orderId}`,
  shipmentId: `7${orderId}`,
  status,
  codAmount: COD,
});
const shipment = (
  orderId: string,
  status: string,
  money: Partial<ElchiShipmentStatus> = {},
): ElchiShipmentStatus => ({
  shipmentId: `7${orderId}`,
  externalOrderId: `mp-order:${orderId}`,
  status,
  collectedFromCustomer: null,
  elchiFee: 40_000,
  marketPaidAmount: 0,
  codAmount: COD,
  extraCost: 0,
  ...money,
});

/**
 * BE-46 TC3 (ega qarori 2026-11-24, «Avtomatik so‘rov»): Elchi bilan kunlik avtomatik tekshiruv — PostgreSQL,
 * checkout va elchi-integration RPC lari o‘rnida stub. Elchi o‘tkazmasi BE-22 `onRemittance` orqali (haqiqiy yozuv).
 */
describePostgres(
  'BE-46 TC3: Elchi bilan avtomatik tekshiruv (PostgreSQL)',
  () => {
    let ds: DataSource;
    let ledger: LedgerService;
    let service: ElchiCheckService;
    let parcels: ElchiCheckParcel[];
    let elchi: Map<string, ElchiShipmentStatus>;
    let notFound: Set<string>;
    let elchiFailed: Set<string>;
    let checkoutDown = false;
    let refetched: ElchiCheckParcel[] | null = null;
    let flag = 'on';
    const checkoutSend = jest.fn();
    const integrationSend = jest.fn();
    const emit = jest.fn();

    const remit = async (orderId: string, money = PAID) => {
      await ledger.onOrderStatusChanged(
        orderEvent({
          eventId: `d-${orderId}`,
          orderId,
          orderNumber: `L-${orderId}`,
          leadId: `9${orderId}`,
          occurredAt: '2027-01-12T10:00:00.000Z',
        }),
      );
      await ledger.onRemittance({
        schemaVersion: 2,
        eventId: `rem-${orderId}`,
        orderId,
        shipmentId: `7${orderId}`,
        elchiStatus: 'paid',
        ...money,
        refusalFee: null,
        occurredAt: '2027-01-13T06:05:00.000Z',
      });
    };
    const itemOf = async (runId: string, orderId: string) =>
      (
        await service.items({
          query: { runId, search: `L-${orderId}` },
        })
      ).items[0];

    beforeAll(async () => {
      if (!new URL(url!).pathname.endsWith('_finance_test'))
        throw new Error(
          'FINANCE_TEST_DATABASE_URL nomi _finance_test bilan tugashi kerak',
        );
      schemaLock = new Client({ connectionString: url });
      await schemaLock.connect();
      await schemaLock.query('SELECT pg_advisory_lock($1)', [
        FINANCE_SCHEMA_TEST_LOCK,
      ]);
      const admin = new Client({ connectionString: url });
      await admin.connect();
      await admin.query('DROP SCHEMA IF EXISTS finance CASCADE');
      await admin.query('CREATE SCHEMA finance');
      await admin.end();
      ds = await new DataSource({
        type: 'postgres',
        url,
        schema: 'finance',
        migrations: [
          CreateFinanceTables1724673600000,
          CreateCodReconciliation1724932800000,
          CreatePayoutSchedule1727568000000,
          CreateLedger1795478400000,
          AddJournalLeadIndex1795564800000,
          CreateWithdrawal1795651200000,
          CreateWholesalerSettlement1795737600000,
          CreateFeeHold1795824000000,
          AddRemittanceResolution1796860800000,
          CreateElchiCheck1797638400000,
          CreateReturnPending1799193600000,
        ],
        migrationsRun: true,
        synchronize: false,
        logging: false,
      }).initialize();
      ledger = new LedgerService(ds);
      checkoutSend.mockImplementation(
        (_pattern: unknown, data: { orderIds?: string[] }) => {
          if (checkoutDown)
            return throwError(() => new Error('checkout javob bermadi'));
          // qayta o‘qish (farq chiqqanlari): `refetched` — tekshiruv davomida o‘zgargan holat
          const list = data?.orderIds ? (refetched ?? parcels) : parcels;
          return of({
            parcels: data?.orderIds
              ? list.filter((p) => data.orderIds!.includes(p.orderId))
              : list,
            truncated: false,
          });
        },
      );
      integrationSend.mockImplementation(
        (_pattern: unknown, data: { shipmentIds: string[] }) =>
          of({
            items: data.shipmentIds
              .filter((id) => elchi.has(id))
              .map((id) => elchi.get(id)),
            notFound: data.shipmentIds.filter((id) => notFound.has(id)),
            failed: data.shipmentIds
              .filter((id) => elchiFailed.has(id))
              .map((id) => ({
                shipmentId: id,
                error: 'Elchi: vaqtincha xato',
              })),
          }),
      );
      emit.mockImplementation(() => of(undefined));
      service = new ElchiCheckService(
        ds,
        { get: () => flag } as never,
        { send: checkoutSend } as never,
        { send: integrationSend } as never,
        { emit } as never,
      );
    }, 300_000);

    afterAll(async () => {
      if (ds?.isInitialized) {
        await ds.query('DROP SCHEMA IF EXISTS finance CASCADE');
        await ds.destroy();
      }
      await schemaLock?.end();
    });

    it('kunlik tekshiruv: mos posilkalar sanaladi, farqlilari ro‘yxatda; izoh ko‘chadi; xabar faqat yangi farqda', async () => {
      // 901 — to‘landi va yozilgan; 902 — Elchi «to‘landi», webhook kelmagan; 903 — yo‘lda; 904 — Elchi topmadi;
      // 905 — Elchi haqi yozilgandan boshqa; 906 — Elchi o‘qiy olmadi; yana 150 ta yo‘ldagi (100 talik bo‘laklar).
      await remit('901');
      await remit('905');
      parcels = [
        parcel('901', S.REMITTED),
        parcel('902', S.DELIVERED),
        parcel('903', S.IN_TRANSIT),
        parcel('904', S.IN_TRANSIT),
        parcel('905', S.REMITTED),
        parcel('906', S.IN_TRANSIT),
        ...Array.from({ length: 150 }, (_, i) =>
          parcel(String(1000 + i), S.IN_TRANSIT),
        ),
      ];
      elchi = new Map(
        [
          shipment('901', 'paid', PAID),
          shipment('902', 'paid', PAID),
          shipment('903', 'on the road'),
          shipment('905', 'paid', { ...PAID, elchiFee: 45_000 }),
          ...Array.from({ length: 150 }, (_, i) =>
            shipment(String(1000 + i), 'waiting'),
          ),
        ].map((s) => [s.shipmentId, s]),
      );
      notFound = new Set(['7904']);
      elchiFailed = new Set(['7906']);

      const first = await service.run('CRON', null);
      expect(first).toMatchObject({
        trigger: 'CRON',
        checked: 156,
        matched: 152,
        diffCount: 3,
        resolvedCount: 0,
        failed: 1,
        truncated: false,
        error: null,
      });
      expect(first.finishedAt).not.toBeNull();
      expect(first.alertedAt).not.toBeNull();
      expect(checkoutSend).toHaveBeenCalledWith(
        { cmd: ELCHI_CHECK_RPC.PARCELS },
        {},
      );
      // Elchi’ga 100 tadan: 156 posilka — ikki so‘rov
      expect(
        integrationSend.mock.calls.map(
          ([, data]) => (data as { shipmentIds: string[] }).shipmentIds.length,
        ),
      ).toEqual([100, 56]);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(ELCHI_CHECK_MISMATCH_EVENT, {
        date: first.date,
        runId: first.id,
        newDiffCount: 3,
        openDiffCount: 3,
        orders: [
          {
            orderId: '902',
            orderNumber: 'L-902',
            reasons: [R.NO_REMITTANCE, R.STATUS],
          },
          { orderId: '904', orderNumber: 'L-904', reasons: [R.NOT_FOUND] },
          { orderId: '905', orderNumber: 'L-905', reasons: [R.FEE] },
        ],
      });

      const page = await service.items({ query: { runId: first.id } });
      expect(page.run).toMatchObject({ id: first.id });
      expect(page.total).toBe(4);
      // ochiq farqlar birinchi
      expect(page.items.map((item) => [item.orderId, item.state])).toEqual([
        ['905', ElchiCheckItemState.DIFF],
        ['904', ElchiCheckItemState.DIFF],
        ['902', ElchiCheckItemState.DIFF],
        ['906', ElchiCheckItemState.FAILED],
      ]);
      expect(await itemOf(first.id, '902')).toMatchObject({
        orderNumber: 'L-902',
        shipmentId: '7902',
        reasons: [R.NO_REMITTANCE, R.STATUS],
        orderStatus: S.DELIVERED,
        elchiStatus: 'paid',
        codAmount: COD,
        elchiCollected: COD,
        elchiFee: 40_000,
        elchiMarketPaid: 251_000,
        recordedCollected: null,
        recordedMarketPaid: null,
        resolution: null,
      });
      expect(await itemOf(first.id, '905')).toMatchObject({
        reasons: [R.FEE],
        elchiFee: 45_000,
        recordedFee: 40_000,
        recordedMarketPaid: 251_000,
      });
      expect(await itemOf(first.id, '906')).toMatchObject({
        state: ElchiCheckItemState.FAILED,
        error: 'Elchi: vaqtincha xato',
      });
      // filtrlar
      expect(
        (
          await service.items({
            query: { runId: first.id, state: ElchiCheckItemState.FAILED },
          })
        ).items.map((item) => item.orderId),
      ).toEqual(['906']);
      expect(
        (
          await service.items({ query: { runId: first.id, search: '7904' } })
        ).items.map((item) => item.orderId),
      ).toEqual(['904']);

      // farqni izoh bilan yopish
      const b = await itemOf(first.id, '902');
      await expect(
        service.resolve({ id: b.id, comment: 'ok', userId: '6' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      const resolved = await service.resolve({
        id: b.id,
        comment: 'Elchi webhookni qayta yuboradi',
        userId: '6',
      });
      expect(resolved).toMatchObject({
        state: ElchiCheckItemState.RESOLVED,
        resolution: {
          comment: 'Elchi webhookni qayta yuboradi',
          by: '6',
          carried: false,
        },
      });
      await expect(
        service.resolve({ id: b.id, comment: 'yana bir marta', userId: '6' }),
      ).rejects.toBeInstanceOf(ConflictException);
      const failedItem = await itemOf(first.id, '906');
      await expect(
        service.resolve({
          id: failedItem.id,
          comment: 'farq yo‘q-ku',
          userId: '6',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.resolve({ id: '999999', comment: 'topilmaydi', userId: '6' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.get({})).resolves.toMatchObject({
        id: first.id,
        diffCount: 2,
        resolvedCount: 1,
      });

      // 2-tekshiruv, Elchi o‘zgarmagan: 902 yopiq qoladi (izoh ko‘chadi), 904 va 905 ochiq, lekin yangi emas — xabar yo‘q
      const second = await service.run('MANUAL', '6');
      expect(second).toMatchObject({
        trigger: 'MANUAL',
        diffCount: 2,
        resolvedCount: 1,
        failed: 1,
        alertedAt: null,
      });
      expect(emit).toHaveBeenCalledTimes(1);
      expect(await itemOf(second.id, '902')).toMatchObject({
        state: ElchiCheckItemState.RESOLVED,
        resolution: {
          comment: 'Elchi webhookni qayta yuboradi',
          by: '6',
          carried: true,
        },
      });
      // eski tekshiruvdagi farq — keyin qayta tekshirilgan, yopilmaydi
      const oldD = await itemOf(first.id, '904');
      await expect(
        service.resolve({
          id: oldD.id,
          comment: 'eski ro‘yxatdan',
          userId: '6',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // 3-tekshiruv: 905 tuzaldi; 902 o‘zgardi (Elchi boshqa summa o‘tkazdi) — yangi farq, izoh ko‘chmaydi, xabar
      elchi.set('7905', shipment('905', 'paid', PAID));
      elchi.set(
        '7902',
        shipment('902', 'paid', { ...PAID, marketPaidAmount: 200_000 }),
      );
      const third = await service.run('CRON', null);
      expect(third).toMatchObject({ diffCount: 2, resolvedCount: 0 });
      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit).toHaveBeenLastCalledWith(
        ELCHI_CHECK_MISMATCH_EVENT,
        expect.objectContaining({
          runId: third.id,
          newDiffCount: 1,
          openDiffCount: 2,
          orders: [
            {
              orderId: '902',
              orderNumber: 'L-902',
              reasons: [R.NO_REMITTANCE, R.STATUS],
            },
          ],
        }),
      );
      expect(await itemOf(third.id, '902')).toMatchObject({
        state: ElchiCheckItemState.DIFF,
        elchiMarketPaid: 200_000,
        resolution: null,
      });
      expect(await itemOf(third.id, '905')).toBeUndefined();

      // kun bo‘yicha: oxirgi tekshiruv; boshqa kunda — yo‘q
      await expect(service.get({ date: third.date })).resolves.toMatchObject({
        id: third.id,
      });
      await expect(service.get({ date: '2020-01-01' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.items({ query: { date: '2020-01-01' } }),
      ).resolves.toEqual({
        run: null,
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
    });

    it('checkout javob bermasa — tekshiruv xato bilan yakunlanadi (qator yozilmaydi)', async () => {
      checkoutDown = true;
      try {
        const run = await service.run('CRON', null);
        expect(run.error).toContain('checkout javob bermadi');
        expect(run.finishedAt).not.toBeNull();
        expect((await service.items({ query: { runId: run.id } })).total).toBe(
          0,
        );
      } finally {
        checkoutDown = false;
      }
    });

    it('Elchi hech birini bermasa — hammasi FAILED va tekshiruvda xato', async () => {
      parcels = [parcel('931', S.IN_TRANSIT), parcel('932', S.IN_TRANSIT)];
      integrationSend.mockImplementationOnce(() =>
        throwError(() => new Error('Elchi API 503')),
      );
      const run = await service.run('CRON', null);
      expect(run).toMatchObject({
        checked: 2,
        matched: 0,
        diffCount: 0,
        failed: 2,
        error: 'Elchi hech bir posilka holatini bermadi',
      });
    });

    it('farq yo‘qolib qaytsa — yangi farq: eski izoh ko‘chmaydi, xabar yuboriladi; FAILED kuni yopishni to‘smaydi', async () => {
      parcels = [parcel('960', S.DELIVERED), parcel('961', S.IN_TRANSIT)];
      const drift = shipment('960', 'sold', { collectedFromCustomer: 280_000 });
      elchi = new Map([
        ['7960', drift],
        ['7961', shipment('961', 'cancelled')],
      ]);
      notFound = new Set();
      elchiFailed = new Set();
      // 1: 960 — yig‘ilgan summa farqi, 961 — holat farqi; 960 izoh bilan yopiladi
      const a = await service.run('CRON', null);
      expect(a).toMatchObject({ diffCount: 2 });
      const a960 = await itemOf(a.id, '960');
      expect(a960.reasons).toEqual([R.COLLECTED]);
      await service.resolve({
        id: a960.id,
        comment: 'Elchi bilan kelishildi',
        userId: '6',
      });
      // 2: 960 tuzaldi — farq yo‘qoldi (MATCHED belgisi, ro‘yxatda ko‘rinmaydi); 961 — Elchi o‘qiy olmadi
      elchi.set(
        '7960',
        shipment('960', 'sold', { collectedFromCustomer: COD }),
      );
      elchiFailed = new Set(['7961']);
      elchi.delete('7961');
      const b = await service.run('CRON', null);
      expect(b).toMatchObject({ diffCount: 0, failed: 1, matched: 1 });
      expect(await itemOf(b.id, '960')).toBeUndefined();
      // FAILED keyingi qator 1-tekshiruvdagi 961 farqini yopishni to‘smaydi
      await expect(
        service.resolve({
          id: (await itemOf(a.id, '961')).id,
          comment: 'Elchi bekorni tasdiqladi',
          userId: '6',
        }),
      ).resolves.toMatchObject({ state: ElchiCheckItemState.RESOLVED });
      // 3: 960 da aynan o‘sha farq qaytdi — yangi: izoh ko‘chmaydi, xabar
      elchi.set('7960', drift);
      elchiFailed = new Set();
      elchi.set('7961', shipment('961', 'cancelled'));
      emit.mockClear();
      const c = await service.run('CRON', null);
      expect(await itemOf(c.id, '960')).toMatchObject({
        state: ElchiCheckItemState.DIFF,
        resolution: null,
      });
      // 961: oxirgi ma’lum natija — yopilgan o‘sha farq (FAILED kun hisobga olinmaydi) — izoh ko‘chadi
      expect(await itemOf(c.id, '961')).toMatchObject({
        state: ElchiCheckItemState.RESOLVED,
        resolution: { comment: 'Elchi bekorni tasdiqladi', carried: true },
      });
      expect(emit).toHaveBeenCalledWith(
        ELCHI_CHECK_MISMATCH_EVENT,
        expect.objectContaining({
          newDiffCount: 1,
          orders: [
            { orderId: '960', orderNumber: 'L-960', reasons: [R.COLLECTED] },
          ],
        }),
      );
    });

    it('tekshiruv davomida kelgan Elchi xabari soxta farq bermaydi (farqlilar qayta o‘qiladi)', async () => {
      parcels = [parcel('970', S.IN_TRANSIT)];
      elchi = new Map([
        ['7970', shipment('970', 'sold', { collectedFromCustomer: COD })],
      ]);
      // ro‘yxat olingandan keyin «sotildi» xabari keldi — bizda endi DELIVERED
      refetched = [parcel('970', S.DELIVERED)];
      try {
        const run = await service.run('CRON', null);
        expect(run).toMatchObject({ checked: 1, matched: 1, diffCount: 0 });
        expect(checkoutSend).toHaveBeenLastCalledWith(
          { cmd: ELCHI_CHECK_RPC.PARCELS },
          { orderIds: ['970'] },
        );
      } finally {
        refetched = null;
      }
    });

    it('rad etilgan posilka: Elchi xarajati moliyadagi rad to‘lovi bilan solishtiriladi', async () => {
      await ledger.onOrderStatusChanged(
        orderEvent({
          status: S.REFUSED,
          eventId: 'r-980',
          orderId: '980',
          orderNumber: 'L-980',
          leadId: '9980',
          occurredAt: '2027-01-12T10:00:00.000Z',
        }),
      );
      await ledger.onRemittance({
        schemaVersion: 2,
        eventId: 'rem-980',
        orderId: '980',
        shipmentId: '7980',
        elchiStatus: 'closed' as 'paid',
        collectedFromCustomer: 0,
        elchiFee: 0,
        marketPaidAmount: 0,
        refusalFee: 20_000,
        occurredAt: '2027-01-13T06:05:00.000Z',
      });
      parcels = [parcel('980', S.REFUSED), parcel('981', S.REFUSED)];
      elchi = new Map([
        ['7980', shipment('980', 'cancelled', { extraCost: 20_000 })],
        ['7981', shipment('981', 'cancelled', { extraCost: 20_000 })],
      ]);
      const run = await service.run('CRON', null);
      expect(run).toMatchObject({ matched: 1, diffCount: 1 });
      expect(await itemOf(run.id, '981')).toMatchObject({
        reasons: [R.REFUSAL_FEE],
        elchiExtraCost: 20_000,
        recordedRefusalFee: null,
      });
    });

    it('Elchi uzilishi: ketma-ket 3 bo‘lak o‘qilmasa qolgani so‘ralmaydi', async () => {
      parcels = Array.from({ length: 450 }, (_, i) =>
        parcel(String(3000 + i), S.IN_TRANSIT),
      );
      integrationSend.mockClear();
      integrationSend.mockImplementation(() =>
        throwError(() => new Error('Elchi API 503')),
      );
      try {
        const run = await service.run('CRON', null);
        expect(integrationSend).toHaveBeenCalledTimes(3);
        expect(run).toMatchObject({ checked: 450, failed: 450 });
        expect((await itemOf(run.id, '3449')).error).toBe(
          'Elchi javob bermadi — tekshiruv to‘xtatildi',
        );
        expect((await itemOf(run.id, '3000')).error).toBe('Elchi API 503');
      } finally {
        integrationSend.mockImplementation(
          (_pattern: unknown, data: { shipmentIds: string[] }) =>
            of({
              items: data.shipmentIds
                .filter((id) => elchi.has(id))
                .map((id) => elchi.get(id)),
              notFound: data.shipmentIds.filter((id) => notFound.has(id)),
              failed: [],
            }),
        );
      }
    });

    it('uzilgan tekshiruv yopiladi; ro‘yxat sukut bo‘yicha oxirgi muvaffaqiyatli tekshiruvdan', async () => {
      parcels = [parcel('990', S.DELIVERED)];
      elchi = new Map([['7990', shipment('990', 'paid', PAID)]]);
      const ok = await service.run('CRON', null);
      expect(ok).toMatchObject({ diffCount: 1 });
      const [orphan] = (await ds.query(
        `INSERT INTO finance.elchi_check_run (check_date, trigger) VALUES (current_date, 'CRON') RETURNING id::text`,
      )) as Array<{ id: string }>;
      // ishlayotgan (yoki uzilgan) tekshiruv oldingi farqlarni yashirmaydi
      await expect(service.items({ query: {} })).resolves.toMatchObject({
        run: { id: ok.id },
        total: 1,
      });
      checkoutDown = true;
      try {
        const failed = await service.run('CRON', null);
        expect(failed.error).toContain('checkout javob bermadi');
      } finally {
        checkoutDown = false;
      }
      const [closed] = (await ds.query(
        `SELECT finished_at IS NOT NULL AS done, error FROM finance.elchi_check_run WHERE id = $1`,
        [orphan.id],
      )) as Array<{ done: boolean; error: string }>;
      expect(closed).toEqual({
        done: true,
        error: 'Tekshiruv uzildi (servis to‘xtagan)',
      });
      // yiqilgan tekshiruv ham yashirmaydi
      await expect(service.items({ query: {} })).resolves.toMatchObject({
        run: { id: ok.id },
      });
      await expect(service.get({})).resolves.toMatchObject({
        error: expect.stringContaining('checkout javob bermadi'),
      });
    });

    it('qo‘lda ishga tushirish: qulf band — darhol 409; bo‘sh — fonda ishlaydi; kunlik ish bayroqsiz ishlamaydi', async () => {
      await expect(service.start({ userId: 'x' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.items({ query: { runId: '9999999999999999999' } }),
      ).rejects.toBeInstanceOf(BadRequestException);
      const holder = new Client({ connectionString: url });
      await holder.connect();
      try {
        await holder.query('SELECT pg_advisory_lock($1, hashtext($2))', [
          LEADER_LOCK_CLASS,
          'finance-elchi-check',
        ]);
        await expect(service.start({ userId: '6' })).rejects.toBeInstanceOf(
          ConflictException,
        );
      } finally {
        await holder.end();
      }
      parcels = [parcel('995', S.IN_TRANSIT)];
      elchi = new Map([['7995', shipment('995', 'on the road')]]);
      const before = (await service.get({})).id;
      await expect(service.start({ userId: '6' })).resolves.toEqual({
        accepted: true,
      });
      let latest = await service.get({});
      for (
        let i = 0;
        i < 50 && (latest.id === before || !latest.finishedAt);
        i++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        latest = await service.get({});
      }
      expect(latest).toMatchObject({
        trigger: 'MANUAL',
        checked: 1,
        matched: 1,
      });

      flag = 'off';
      checkoutSend.mockClear();
      await service.daily();
      expect(checkoutSend).not.toHaveBeenCalled();
      flag = 'on';
    });
  },
);
