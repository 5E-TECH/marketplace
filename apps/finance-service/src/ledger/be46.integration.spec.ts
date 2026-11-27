import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import {
  LeadOrderStatus,
  RemittanceViewState,
  SettlementDisputeStatus,
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
import { CreateSettlementResponse1796947200000 } from '../migrations/1796947200000-create-settlement-response';
import { CreateReturnPending1799193600000 } from '../migrations/1799193600000-create-return-pending';
import { BalanceCheckService } from './balance-check.service';
import { LedgerQueryService } from './ledger-query.service';
import { LedgerService } from './ledger.service';
import { orderEvent } from './order-events.samples';
import { PlatformMetricsService } from './platform-metrics.service';
import { RemittanceService } from './remittance.service';
import { SettlementResponseService } from './settlement-response.service';

const url = process.env.FINANCE_TEST_DATABASE_URL;
const describePostgres = url ? describe : describe.skip;
const FINANCE_SCHEMA_TEST_LOCK = 2_304_001;
let schemaLock: Client | undefined;

/**
 * BE-46 — moliya qismi (PostgreSQL): Elchi sverkasi farqini yopish (FE-19 TC2), 9-bo‘lim moliya ko‘rsatkichlari,
 * optovik akti qabuli va e’tirozi (FE-24, TC4). Namuna buyurtma (order-events.samples): tasdiqlangan narx 251 000,
 * optovik 140 000, sotuvchi haqi 65 000, qo‘ng‘iroq markazi 12 000 → platforma ulushi 34 000 (split.ts);
 * rad to‘lovi 20 000 (sozlama seed, 6-qaror).
 */
describePostgres(
  'BE-46 moliya: sverka, ko‘rsatkichlar, akt javobi (PostgreSQL)',
  () => {
    let ds: DataSource;
    let ledger: LedgerService;
    let remittances: RemittanceService;
    let metrics: PlatformMetricsService;
    let responses: SettlementResponseService;
    let check: BalanceCheckService;
    let seq = 0;

    /** Yetkazilgan buyurtma (Toshkent kuni — `at`). */
    const deliver = async (at: string) => {
      const orderId = String(900 + ++seq);
      await ledger.onOrderStatusChanged(
        orderEvent({
          eventId: `d-${orderId}`,
          orderId,
          orderNumber: `L-${orderId}`,
          leadId: String(9000 + seq),
          affiliateId: '42',
          wholesalerId: '501',
          occurredAt: at,
        }),
      );
      return orderId;
    };
    const refuse = async (at: string) => {
      const orderId = String(900 + ++seq);
      await ledger.onOrderStatusChanged(
        orderEvent({
          status: LeadOrderStatus.REFUSED,
          eventId: `r-${orderId}`,
          orderId,
          orderNumber: `L-${orderId}`,
          leadId: String(9000 + seq),
          affiliateId: '42',
          wholesalerId: '501',
          occurredAt: at,
        }),
      );
      return orderId;
    };
    /** Elchi o‘tkazmasi; qator kelgan vaqt `receivedAt` (o‘tkazma kuni) ga qo‘yiladi. */
    const remit = async (
      orderId: string,
      receivedAt: string,
      over: { paid?: number; refusalFee?: number; status?: string } = {},
    ) => {
      const refused = over.refusalFee !== undefined;
      await ledger.onRemittance({
        schemaVersion: 2,
        eventId: `rem-${orderId}-${++seq}`,
        orderId,
        shipmentId: `s-${orderId}`,
        elchiStatus: (over.status ?? (refused ? 'closed' : 'paid')) as 'paid',
        collectedFromCustomer: refused ? 0 : 291000,
        elchiFee: refused ? 0 : 40000,
        marketPaidAmount: refused ? 0 : (over.paid ?? 251000),
        refusalFee: refused ? over.refusalFee : null,
        occurredAt: receivedAt,
      });
      await ds.query(
        `UPDATE finance.remittance_item SET created_at = $2
        WHERE id = (SELECT max(id) FROM finance.remittance_item WHERE order_id = $1)`,
        [orderId, receivedAt],
      );
    };
    const itemId = async (orderId: string) =>
      String(
        (
          await ds.query(
            `SELECT max(id)::text AS id FROM finance.remittance_item WHERE order_id = $1`,
            [orderId],
          )
        )[0].id,
      );

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
          CreateSettlementResponse1796947200000,
          CreateReturnPending1799193600000,
        ],
        migrationsRun: true,
        synchronize: false,
        logging: false,
      }).initialize();
      ledger = new LedgerService(ds);
      remittances = new RemittanceService(ds);
      metrics = new PlatformMetricsService(ds);
      // Akt DTO si BE-33 dan (SettlementService.get); bu yerda faqat id va holat kerak — konstruktoriga bog‘lanmaslik uchun.
      const settlements = {
        get: async ({ id }: { id: string }) =>
          (
            (await ds.query(
              `SELECT id::text, status FROM finance.wholesaler_settlement WHERE id = $1`,
              [id],
            )) as Array<{ id: string; status: string }>
          )[0],
      };
      responses = new SettlementResponseService(ds, settlements as never);
      check = new BalanceCheckService(ds);
    }, 300_000);

    beforeEach(async () => {
      await ds.query(`TRUNCATE finance.settlement_dispute, finance.wholesaler_settlement_item,
      finance.wholesaler_settlement, finance.withdrawal_approval, finance.withdrawal_request,
      finance.affiliate_payout_profile, finance.ledger_entry, finance.journal, finance.remittance_item,
      finance.elchi_remittance, finance.balance_check, finance.processed_event, finance.event_failure,
      finance.fee_hold`);
      await ds.query(`DELETE FROM finance.account WHERE owner_id <> ''`);
      await ds.query(
        `UPDATE finance.account SET hold_balance = 0, available_balance = 0`,
      );
    });

    afterAll(async () => {
      if (ds?.isInitialized) {
        await ds.query('DROP SCHEMA IF EXISTS finance CASCADE');
        await ds.destroy();
      }
      await schemaLock?.end();
    });

    describe('Elchi sverkasi (FE-19)', () => {
      // 12.01 yetkazilgan, 13.01 11:05 Toshkent o‘tkazma keldi (DZ-07 lahzasi kabi).
      const DAY = '2027-01-13';
      const RECEIVED = '2027-01-13T06:05:00.000Z';
      let matched: string;
      let short: string;
      let refused: string;

      beforeEach(async () => {
        matched = await deliver('2027-01-12T10:00:00.000Z');
        short = await deliver('2027-01-12T10:05:00.000Z');
        refused = await refuse('2027-01-12T10:10:00.000Z');
        await remit(matched, RECEIVED);
        await remit(short, RECEIVED, { paid: 247000 }); // Elchi 4 000 ortiqcha ushlagan
        await remit(refused, RECEIVED, { refusalFee: 24000 }); // rad to‘lovi 4 000 ortiq
      });

      it('kun: holat «Farq bor», jami Elchi va tizim hisobi, ochiq farq Elchi − tizim (TC1, TC3)', async () => {
        expect(await remittances.days({ from: DAY, to: DAY })).toEqual([
          {
            day: DAY,
            state: RemittanceViewState.DIFF,
            orders: 3,
            diffCount: 2,
            resolvedCount: 0,
            matchedCount: 1,
            pendingCount: 0,
            collected: 582000,
            elchiFee: 80000,
            refusalFee: 24000,
            // o‘tkazma: 251 000 + 247 000 − 24 000; tizim: 2 × 251 000 − 20 000
            elchiTotal: 474000,
            systemTotal: 482000,
            openDiff: -8000,
          },
        ]);
      });

      it('posilkalar: farqlilari birinchi, rad qatori o‘tkazma ma’nosida manfiy; qidiruv buyurtma raqami bo‘yicha', async () => {
        const page = await remittances.items({ query: { day: DAY } });
        expect(page.total).toBe(3);
        expect(
          page.items.map((i) => [i.orderId, i.state, i.kind, i.diff]),
        ).toEqual([
          [refused, RemittanceViewState.DIFF, 'REFUSED', -4000],
          [short, RemittanceViewState.DIFF, 'DELIVERED', -4000],
          [matched, RemittanceViewState.MATCHED, 'DELIVERED', 0],
        ]);
        const found = await remittances.items({
          query: { search: `L-${short}` },
        });
        expect(found.items.map((i) => i.orderId)).toEqual([short]);
        expect(
          (
            await remittances.items({
              query: { day: DAY, state: RemittanceViewState.MATCHED },
            })
          ).items.map((i) => i.orderId),
        ).toEqual([matched]);
        expect(
          (await remittances.items({ query: { day: '2027-01-14' } })).total,
        ).toBe(0);
      });

      it('TC2: farq izoh bilan yopiladi — kim, qachon, izoh; pul HOLD da qoladi; kechki tekshiruv ochiq deb ko‘rsatmaydi', async () => {
        const hold = async () =>
          (
            await ds.query(
              `SELECT count(*)::int AS n FROM finance.journal j JOIN finance.ledger_entry e ON e.journal_id = j.id
              WHERE j.order_id = $1 AND e.state = 'HOLD'`,
              [short],
            )
          )[0].n as number;
        const holdBefore = await hold();
        const item = await remittances.resolve({
          id: await itemId(short),
          comment: '  Elchi 1 kg ortiqcha hisoblagan — kelishildi  ',
          userId: '17',
        });
        expect(item).toMatchObject({
          orderId: short,
          state: RemittanceViewState.RESOLVED,
          diff: -4000,
          resolution: {
            comment: 'Elchi 1 kg ortiqcha hisoblagan — kelishildi',
            by: '17',
            at: expect.any(Date),
          },
        });
        expect(await hold()).toBe(holdBefore);
        const [day] = await remittances.days({ from: DAY, to: DAY });
        expect(day).toMatchObject({
          state: RemittanceViewState.DIFF,
          diffCount: 1,
          resolvedCount: 1,
          openDiff: -4000,
        });
        const r = await check.run();
        expect(r.details.openRemittances).toEqual([
          { orderId: refused, match: 'MISMATCH' },
        ]);

        // Ikkinchisi ham yopilsa — kun «Hal qilindi»
        await remittances.resolve({
          id: await itemId(refused),
          comment: 'Rad to‘lovi Elchi bilan kelishildi',
          userId: '17',
        });
        expect(
          (await remittances.days({ from: DAY, to: DAY }))[0],
        ).toMatchObject({ state: RemittanceViewState.RESOLVED, openDiff: 0 });
      });

      it('yopish: takror, farqsiz qator — 409; izohsiz — 400; yo‘q qator — 404', async () => {
        const id = await itemId(short);
        await remittances.resolve({ id, comment: 'Kelishildi', userId: '17' });
        await expect(
          remittances.resolve({ id, comment: 'Yana', userId: '17' }),
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
          remittances.resolve({
            id: await itemId(matched),
            comment: 'Kelishildi',
            userId: '17',
          }),
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
          remittances.resolve({
            id: await itemId(refused),
            comment: '  ',
            userId: '17',
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          remittances.resolve({
            id: '999999',
            comment: 'Kelishildi',
            userId: '17',
          }),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('yopilgandan keyin yangi o‘tkazma kelsa — farq yana ochiq', async () => {
        await remittances.resolve({
          id: await itemId(short),
          comment: 'Kelishildi',
          userId: '17',
        });
        await remit(short, '2027-01-14T06:00:00.000Z', { paid: 246000 });
        const page = await remittances.items({ query: { search: short } });
        expect(page.items).toHaveLength(1);
        expect(page.items[0]).toMatchObject({
          state: RemittanceViewState.DIFF,
          diff: -5000,
          resolution: null,
        });
      });
    });

    describe('9-bo‘lim moliya ko‘rsatkichlari (FE-22)', () => {
      const paidWithdrawal = async (
        affiliateId: string,
        requestedAt: string,
        paidAt: string,
      ) => {
        const [{ id: journalId }] = (await ds.query(
          `INSERT INTO finance.journal (kind, reference_id, gross_amount, event_id, occurred_at)
         VALUES ('WITHDRAWAL_PAID', $1, 100000, $1, $2) RETURNING id::text`,
          [`w-${affiliateId}-${requestedAt}`, paidAt],
        )) as Array<{ id: string }>;
        await ds.query(
          `INSERT INTO finance.withdrawal_request
           (affiliate_id, amount, tax_amount, net_amount, status, required_approvals, request_day,
            paid_at, journal_id, created_at)
         VALUES ($1, 100000, 1000, 99000, 'PAID', 1, ($2::timestamptz AT TIME ZONE 'Asia/Tashkent')::date,
                 $3, $4, $2)`,
          [affiliateId, requestedAt, paidAt, journalId],
        );
      };

      it('platforma ulushi (rad to‘lovi bilan), hissa bitta sotuvdan, sverka farqi, pul yechish mediani — kun va jami', async () => {
        // 12.01: 2 ta yetkazildi, 1 ta rad; 13.01: 1 ta yetkazildi.
        const a = await deliver('2027-01-12T05:00:00.000Z');
        await deliver('2027-01-12T06:00:00.000Z');
        await refuse('2027-01-12T07:00:00.000Z');
        await deliver('2027-01-13T05:00:00.000Z');
        await remit(a, '2027-01-12T12:00:00.000Z', { paid: 247000 });
        // Pul yechish (to‘langan kun bo‘yicha): 11.01 da 10 soatlik (davrdan tashqari), 12.01 da 30, 13.01 da 5 soatlik.
        await paidWithdrawal(
          '42',
          '2027-01-11T00:00:00.000Z',
          '2027-01-11T10:00:00.000Z',
        );
        await paidWithdrawal(
          '43',
          '2027-01-11T00:00:00.000Z',
          '2027-01-12T06:00:00.000Z',
        );
        await paidWithdrawal(
          '44',
          '2027-01-13T00:00:00.000Z',
          '2027-01-13T05:00:00.000Z',
        );

        const r = await metrics.platform({
          from: '2027-01-12',
          to: '2027-01-13',
        });
        expect(r.rows).toEqual([
          {
            key: '2027-01-12',
            platformShare: 48000, // 2 × 34 000 − 20 000
            contributionPerSale: 24000,
            reconciliationDiff: -4000,
            withdrawalMedianHours: 30,
          },
          {
            key: '2027-01-13',
            platformShare: 34000,
            contributionPerSale: 34000,
            reconciliationDiff: 0,
            withdrawalMedianHours: 5,
          },
        ]);
        // Davrda 30 va 5 soatlik → median 17,5.
        expect(r.totals).toEqual({
          key: 'TOTAL',
          platformShare: 82000,
          contributionPerSale: 27333,
          reconciliationDiff: -4000,
          withdrawalMedianHours: 17.5,
        });
      });

      it('bo‘sh davr — nol va null, har kun qatori bor; noto‘g‘ri davr — 400', async () => {
        const r = await metrics.platform({
          from: '2027-02-01',
          to: '2027-02-02',
        });
        expect(r.rows.map((x) => x.key)).toEqual(['2027-02-01', '2027-02-02']);
        expect(r.totals).toEqual({
          key: 'TOTAL',
          platformShare: 0,
          contributionPerSale: null,
          reconciliationDiff: 0,
          withdrawalMedianHours: null,
        });
        await expect(
          metrics.platform({ from: '2027-02-02', to: '2027-02-01' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          metrics.platform({ from: '2026-01-01', to: '2027-02-01' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    describe('optovik akti: qabul va e’tiroz (FE-24)', () => {
      const act = async (
        wholesalerId: string,
        status = 'READY',
        periodEnd = '2027-01-10',
      ) =>
        String(
          (
            await ds.query(
              `INSERT INTO finance.wholesaler_settlement
               (wholesaler_id, period_start, period_end, return_window_days, status, total_amount)
             VALUES ($1, $3::date - 6, $3::date, 10, $2, 0) RETURNING id::text`,
              [wholesalerId, status, periodEnd],
            )
          )[0].id,
        );

      it('TC4: boshqa optovik akti — 403 (ko‘rish, qabul, e’tiroz); yo‘q akt — 404', async () => {
        const id = await act('501');
        await expect(
          responses.wholesalerGet({ id, wholesalerId: '502' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          responses.accept({ id, wholesalerId: '502', userId: '77' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          responses.dispute({
            id,
            wholesalerId: '502',
            userId: '77',
            comment: 'Mos emas',
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          responses.wholesalerGet({ id: '999999', wholesalerId: '501' }),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(
          (
            await ds.query(
              `SELECT count(*)::int AS n FROM finance.settlement_dispute`,
            )
          )[0].n,
        ).toBe(0);
      });

      it('e’tiroz → moliyaga ko‘rinadi → javob aktda; keyin qabul; qabuldan keyin e’tiroz yo‘q', async () => {
        const id = await act('501');
        const disputed = await responses.dispute({
          id,
          wholesalerId: '501',
          userId: '77',
          comment: 'Quloqchin 2 donasi aktda yo‘q',
        });
        expect(disputed.acceptedAt).toBeNull();
        expect(disputed.disputes).toEqual([
          expect.objectContaining({
            settlementId: id,
            settlementNumber: `AS-${id.padStart(6, '0')}`,
            comment: 'Quloqchin 2 donasi aktda yo‘q',
            createdBy: '77',
            status: SettlementDisputeStatus.OPEN,
            answer: null,
          }),
        ]);
        // Ochiq e’tiroz bor: qabul ham, ikkinchi e’tiroz ham — 409
        await expect(
          responses.accept({ id, wholesalerId: '501', userId: '77' }),
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
          responses.dispute({
            id,
            wholesalerId: '501',
            userId: '77',
            comment: 'Yana',
          }),
        ).rejects.toBeInstanceOf(ConflictException);

        const open = await responses.disputes({
          query: { status: SettlementDisputeStatus.OPEN },
        });
        expect(open.total).toBe(1);
        const disputeId = open.items[0].id;
        const answered = await responses.answer({
          id: disputeId,
          userId: '17',
          comment: 'Ikki dona qaytarish muddati o‘tmagan — keyingi aktda',
        });
        expect(answered).toMatchObject({
          status: SettlementDisputeStatus.ANSWERED,
          answer: 'Ikki dona qaytarish muddati o‘tmagan — keyingi aktda',
          answeredBy: '17',
        });
        await expect(
          responses.answer({ id: disputeId, userId: '17', comment: 'Yana' }),
        ).rejects.toBeInstanceOf(ConflictException);

        const viewed = await responses.wholesalerGet({
          id,
          wholesalerId: '501',
        });
        expect(viewed.disputes[0].answer).toBe(
          'Ikki dona qaytarish muddati o‘tmagan — keyingi aktda',
        );
        expect(viewed.settlement.id).toBe(id);

        const accepted = await responses.accept({
          id,
          wholesalerId: '501',
          userId: '77',
        });
        expect(accepted.acceptedBy).toBe('77');
        expect(accepted.acceptedAt).toBeInstanceOf(Date);
        // takror — o‘sha natija
        const again = await responses.accept({
          id,
          wholesalerId: '501',
          userId: '78',
        });
        expect(again.acceptedBy).toBe('77');
        expect(again.acceptedAt).toEqual(accepted.acceptedAt);
        await expect(
          responses.dispute({
            id,
            wholesalerId: '501',
            userId: '77',
            comment: 'Kech qoldim',
          }),
        ).rejects.toBeInstanceOf(ConflictException);
        // Akt holati (to‘lov) o‘zgarmaydi
        expect(accepted.settlement.status).toBe('READY');
        expect((await responses.adminGet({ id })).acceptedBy).toBe('77');
      });

      it('tovarlar qaytgan akt (VOID) — javob yo‘q; izohsiz e’tiroz — 400', async () => {
        const voided = await act('501', 'VOID');
        await expect(
          responses.accept({ id: voided, wholesalerId: '501', userId: '77' }),
        ).rejects.toBeInstanceOf(ConflictException);
        const id = await act('501', 'READY', '2027-01-17');
        await expect(
          responses.dispute({
            id,
            wholesalerId: '501',
            userId: '77',
            comment: ' a ',
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    describe('tekshiruv topilmalari: buyurtma bo‘yicha bitta qator, ko‘rilmagan farq, ledger daromadi, qabul summasi', () => {
      it('ko‘rilgandan keyin yangi farqli o‘tkazma kelsa — eski qatordan yopish 409; yangisidan yopilsa ikkalasi yopiladi', async () => {
        const order = await deliver('2027-01-12T10:00:00.000Z');
        await remit(order, '2027-01-13T06:00:00.000Z', { paid: 247000 });
        const seen = await itemId(order);
        await remit(order, '2027-01-13T07:00:00.000Z', { paid: 200000 });
        await expect(
          remittances.resolve({
            id: seen,
            comment: 'Kelishildi',
            userId: '17',
          }),
        ).rejects.toBeInstanceOf(ConflictException);
        const page = await remittances.items({ query: { search: order } });
        expect(page.items).toHaveLength(1);
        expect(page.items[0]).toMatchObject({
          id: await itemId(order),
          state: RemittanceViewState.DIFF,
          diff: -51000,
        });
        await remittances.resolve({
          id: page.items[0].id,
          comment: 'Elchi qolganini keyin o‘tkazadi',
          userId: '17',
        });
        expect(
          (
            await ds.query(
              `SELECT count(*)::int AS n FROM finance.remittance_item WHERE order_id = $1 AND resolved_at IS NULL`,
              [order],
            )
          )[0].n,
        ).toBe(0);
      });

      it('bir buyurtma ikki kunda o‘tkazma olsa — faqat oxirgi kunida, Elchi summasi oxirgi snapshot; kunlar yig‘indisi = jami', async () => {
        const order = await deliver('2027-01-11T10:00:00.000Z');
        await remit(order, '2027-01-12T06:00:00.000Z', {
          paid: 100000,
          status: 'partly_paid',
        });
        await remit(order, '2027-01-13T06:00:00.000Z', {
          paid: 200000,
          status: 'partly_paid',
        });
        const days = await remittances.days({
          from: '2027-01-12',
          to: '2027-01-13',
        });
        expect(days).toEqual([
          expect.objectContaining({
            day: '2027-01-13',
            orders: 1,
            elchiTotal: 200000,
            systemTotal: 251000,
            openDiff: -51000,
          }),
        ]);
        const r = await metrics.platform({
          from: '2027-01-12',
          to: '2027-01-13',
        });
        expect(r.rows.map((x) => x.reconciliationDiff)).toEqual([0, -51000]);
        expect(r.totals.reconciliationDiff).toBe(-51000);
      });

      it('hisob-kitobdan keyin ortiqcha to‘lov, keyin takror — farq ekranda ko‘rinadi va yopiladi; kechki tekshiruv ham yopilganini ko‘rmaydi', async () => {
        const order = await deliver('2027-01-12T10:00:00.000Z');
        await remit(order, '2027-01-13T06:00:00.000Z'); // MATCHED
        await remit(order, '2027-01-13T07:00:00.000Z', { paid: 260000 }); // ortiqcha
        const extra = await itemId(order);
        await remit(order, '2027-01-13T08:00:00.000Z'); // takror, MATCHED
        const [row] = (await remittances.items({ query: { search: order } }))
          .items;
        expect(row).toMatchObject({
          id: extra,
          state: RemittanceViewState.DIFF,
          diff: 9000,
        });
        await remittances.resolve({
          id: extra,
          comment: 'Elchi ortiqchasini qaytardi',
          userId: '17',
        });
        expect(
          (await remittances.items({ query: { search: order } })).items[0]
            .state,
        ).toBe(RemittanceViewState.RESOLVED);
        expect(
          (await check.run()).details.openRemittances.filter(
            (x: { orderId: string }) => x.orderId === order,
          ),
        ).toEqual([]);
      });

      it('sotuvchi daromadi ledgerdan: qaytarilgan kunda minus; sotuvchi kesimi BE-28 finance.affiliate.income bilan bir xil', async () => {
        const kept = await deliver('2027-01-12T05:00:00.000Z');
        const returned = await deliver('2027-01-12T06:00:00.000Z');
        await ledger.onOrderReturned({
          eventId: `ret-${returned}`,
          orderId: returned,
          returnRequestId: `RR-${returned}`,
          items: [{ productId: '88', quantity: 1 }],
          occurredAt: '2027-01-13T06:00:00.000Z',
        });
        const q = { from: '2027-01-12', to: '2027-01-13' };
        expect(await metrics.affiliateIncome({ ...q, groupBy: 'DAY' })).toEqual(
          {
            rows: [
              { key: '2027-01-12', amount: 130000 },
              { key: '2027-01-13', amount: -65000 },
            ],
            total: 65000,
          },
        );
        expect(
          await metrics.affiliateIncome({ ...q, groupBy: 'OFFER' }),
        ).toEqual({ rows: [{ key: '88', amount: 65000 }], total: 65000 });
        const byAffiliate = await metrics.affiliateIncome({
          ...q,
          groupBy: 'AFFILIATE',
        });
        const be28 = await new LedgerQueryService(ds).affiliateIncome({
          affiliateId: '42',
          ...q,
        });
        expect(byAffiliate.rows).toEqual([
          { key: '42', amount: be28.lines.reduce((a, l) => a + l.amount, 0) },
        ]);
        expect(byAffiliate.total).toBe(65000);
        expect(kept).toBeDefined();
        await expect(
          metrics.affiliateIncome({ ...q, groupBy: 'X' as never }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('qabul summaga bog‘liq: bank faylida summa o‘zgarsa qabul amalda emas — e’tiroz yoki qayta qabul; optovikka xodim ID lari ko‘rinmaydi', async () => {
        const [{ id }] = (await ds.query(
          `INSERT INTO finance.wholesaler_settlement
             (wholesaler_id, period_start, period_end, return_window_days, status, total_amount)
           VALUES ('501', '2027-01-18', '2027-01-24', 10, 'READY', 1000000) RETURNING id::text`,
        )) as Array<{ id: string }>;
        const accepted = await responses.accept({
          id,
          wholesalerId: '501',
          userId: '77',
        });
        expect(accepted.acceptedAmount).toBe(1000000);
        // BE-33 bank fayli: qaytgan tovar chiqdi, summa muzladi — 700 000
        await ds.query(
          `UPDATE finance.wholesaler_settlement
              SET status = 'EXPORTED', exported_total = 700000, exported_at = now() WHERE id = $1`,
          [id],
        );
        const stale = await responses.wholesalerGet({
          id,
          wholesalerId: '501',
        });
        expect(stale).toMatchObject({
          acceptedAt: null,
          acceptedBy: null,
          acceptedAmount: null,
        });
        const disputed = await responses.dispute({
          id,
          wholesalerId: '501',
          userId: '77',
          comment: 'Nega 700 000?',
        });
        await responses.answer({
          id: disputed.disputes[0].id,
          userId: '17',
          comment: 'Ikki dona qaytdi',
        });
        const viewed = await responses.wholesalerGet({
          id,
          wholesalerId: '501',
        });
        expect(viewed.disputes[0]).toMatchObject({
          answer: 'Ikki dona qaytdi',
          answeredBy: null,
        });
        expect(viewed.settlement.paidBy).toBeNull();
        expect((await responses.adminGet({ id })).disputes[0].answeredBy).toBe(
          '17',
        );
        const again = await responses.accept({
          id,
          wholesalerId: '501',
          userId: '77',
        });
        expect(again.acceptedAmount).toBe(700000);
      });

      it('qarzga to‘liq ushlangan akt (NETTED) — eski qabul amalda emas, e’tiroz mumkin', async () => {
        const [{ id }] = (await ds.query(
          `INSERT INTO finance.wholesaler_settlement
             (wholesaler_id, period_start, period_end, return_window_days, status, total_amount)
           VALUES ('501', '2027-01-25', '2027-01-31', 10, 'READY', 1000000) RETURNING id::text`,
        )) as Array<{ id: string }>;
        await responses.accept({ id, wholesalerId: '501', userId: '77' });
        await ds.query(
          `UPDATE finance.wholesaler_settlement SET status = 'NETTED', debt_deducted = 1000000 WHERE id = $1`,
          [id],
        );
        expect(
          (await responses.wholesalerGet({ id, wholesalerId: '501' }))
            .acceptedAmount,
        ).toBeNull();
        const disputed = await responses.dispute({
          id,
          wholesalerId: '501',
          userId: '77',
          comment: 'Qaysi qarz ushlandi?',
        });
        expect(disputed.disputes).toHaveLength(1);
      });
    });
  },
);
