import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  sealPayoutToken,
  WITHDRAWAL_FAILED_EVENT,
  WITHDRAWAL_OVERDUE_EVENT,
  WithdrawalPayoutMode,
  WithdrawalStatus,
} from '@app/common';
import { FINANCE_DB } from '../database';
import { BalanceCheckService } from '../ledger/balance-check.service';
import { LedgerService } from '../ledger/ledger.service';
import { orderEvent } from '../ledger/order-events.samples';
import { SelfEmployedService } from '../ledger/self-employed.service';
import { WithdrawalService } from '../ledger/withdrawal.service';
import {
  PayoutRejectedError,
  PayoutResult,
  PayoutUnknownError,
} from './payout.provider';
import { PayoutService, SYSTEM_PAYER } from './payout.service';

const url = process.env.FINANCE_TEST_DATABASE_URL;
const describePostgres = url ? describe : describe.skip;
/** finance sxemasi testlari ketma-ket (withdrawal, ledger spec’lari bilan bir qulf). */
const FINANCE_SCHEMA_TEST_LOCK = 2_304_001;
const KEY = 'payout-test-key-0123456789abcdef0123456789';
const TOKEN = 'tok_live_A1b2C3d4E5f6';

/** BE-32 sotuvchi kartasiga to‘lov — haqiqiy PostgreSQL, provayder soxta. */
describePostgres('BE-32 kartaga to‘lov (PostgreSQL)', () => {
  let ds: DataSource;
  let schemaLock: Client;
  let ledger: LedgerService;
  let withdrawals: WithdrawalService;
  let check: BalanceCheckService;
  let payouts: PayoutService;
  let seq = 0;
  const env: Record<string, string | undefined> = {};
  const emitted: Array<{ pattern: string; payload: any }> = [];
  const provider = {
    isConfigured: jest.fn(() => true),
    createCardSession: jest.fn(async () => ({
      url: 'https://pay.test/bind/1',
    })),
    send: jest.fn<Promise<PayoutResult>, [any]>(),
    status: jest.fn<Promise<PayoutResult | null>, [string]>(),
  };

  const fund = async (affiliateId: string, fee: number) => {
    const orderId = String(700 + ++seq);
    const approved = 140000 + fee + 12000;
    await ledger.onOrderStatusChanged(
      orderEvent(
        {
          eventId: `d-${orderId}`,
          orderId,
          leadId: String(9100 + seq),
          affiliateId,
          codAmount: approved + 40000,
        },
        {
          approvedPrice: approved,
          salePrice: approved,
          basePrice: 140000,
          split: { affiliateFee: fee, callCenterFee: 12000, hiddenDelivery: 0 },
        },
      ),
    );
    await ledger.onRemittance({
      schemaVersion: 2,
      eventId: `rem-${orderId}`,
      orderId,
      shipmentId: `s-${orderId}`,
      elchiStatus: 'paid',
      collectedFromCustomer: approved + 40000,
      elchiFee: 40000,
      marketPaidAmount: approved,
      occurredAt: '2026-12-21T10:00:00.000Z',
    });
  };
  const selfEmployed = (affiliateId = '42') =>
    new SelfEmployedService(ds, { get: () => undefined } as never).setManually({
      affiliateId,
      selfEmployed: true,
      updatedBy: '7',
      fullName: 'Sotuvchi',
    });
  let event = 0;
  const bindCard = async (affiliateId = '42', last4 = '1234') => {
    await payouts.createSession({ affiliateId });
    const [{ ref }] = (await ds.query(
      `SELECT ref::text FROM finance.payout_card_session WHERE affiliate_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [affiliateId],
    )) as Array<{ ref: string }>;
    await payouts.onCardBound({
      eventId: `card-${++event}`,
      sessionRef: ref,
      tokenCipher: sealPayoutToken(`${TOKEN}-${affiliateId}-${last4}`, KEY),
      mask: `8600 **** **** ${last4}`,
      system: 'UZCARD' as never,
      holderName: 'AZIZA KARIMOVA',
    });
    return ref;
  };
  /** 1 000 000 so‘mlik tasdiqlangan so‘rov (1 tasdiq). */
  const approved = async (affiliateId = '42', amount = 1_000_000) => {
    await fund(affiliateId, amount);
    await selfEmployed(affiliateId);
    const w = await withdrawals.create({ affiliateId, amount });
    await withdrawals.approve({
      id: w.id,
      approverId: '7',
      currentFullName: 'Sotuvchi',
    });
    return w.id;
  };
  const balance = (affiliateId = '42') => withdrawals.balance({ affiliateId });
  const expectBalanced = async () => {
    const result = await check.run();
    expect(result.details.unbalancedJournals).toEqual([]);
    expect(result.ok).toBe(true);
  };
  const ageSent = (id: string) =>
    ds.query(
      `UPDATE finance.withdrawal_request SET payout_sent_at = now() - interval '2 minutes' WHERE id = $1`,
      [id],
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
      migrations: FINANCE_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    ledger = new LedgerService(ds);
    withdrawals = new WithdrawalService(ds, ledger);
    check = new BalanceCheckService(ds);
    payouts = new PayoutService(
      ds,
      { get: (k: string) => env[k] } as never,
      provider as never,
      withdrawals,
      {
        emit: (pattern: string, payload: unknown) => {
          emitted.push({ pattern, payload });
          return of(undefined);
        },
      } as never,
    );
  }, 300_000);

  beforeEach(async () => {
    await ds.query(`TRUNCATE finance.withdrawal_approval, finance.withdrawal_request, finance.payout_card, finance.payout_card_session,
      finance.affiliate_payout_profile, finance.self_employed_application, finance.ledger_entry, finance.journal,
      finance.remittance_item, finance.elchi_remittance, finance.balance_check, finance.processed_event, finance.event_failure,
      finance.fee_hold CASCADE`);
    await ds.query(`DELETE FROM finance.account WHERE owner_id <> ''`);
    await ds.query(
      `UPDATE finance.account SET hold_balance = 0, available_balance = 0`,
    );
    Object.assign(env, {
      PAYOUT_API_URL: 'https://pay.test',
      PAYOUT_SECRET_KEY: KEY,
      PAYOUT_RETURN_URL: 'https://panel.test/balans',
      SELF_EMPLOYED_SECRET_KEY: undefined,
    });
    emitted.length = 0;
    provider.isConfigured.mockImplementation(() => true);
    provider.send.mockReset();
    provider.status.mockReset();
    provider.createCardSession.mockClear();
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS finance CASCADE');
      await ds.destroy();
    }
    await schemaLock?.end();
  });

  describe('karta', () => {
    it('sessiya → provayder sahifasi; card.bound → faqat niqob ko‘rinadi; yangi karta eskisi o‘rniga', async () => {
      expect(await payouts.card({ affiliateId: '42' })).toEqual({
        enabled: true,
        card: null,
      });
      const session = await payouts.createSession({ affiliateId: '42' });
      expect(session.url).toBe('https://pay.test/bind/1');
      expect(provider.createCardSession).toHaveBeenCalledWith(
        expect.objectContaining({
          returnUrl: 'https://panel.test/balans',
          pinfl: null,
        }),
      );
      await bindCard('42', '1234');
      expect(await payouts.card({ affiliateId: '42' })).toMatchObject({
        card: {
          mask: '8600 **** **** 1234',
          system: 'UZCARD',
          holderName: 'AZIZA KARIMOVA',
        },
      });
      await bindCard('42', '9876');
      expect((await payouts.card({ affiliateId: '42' })).card?.mask).toBe(
        '8600 **** **** 9876',
      );
      expect(
        await ds.query(
          `SELECT status, count(*)::int AS n FROM finance.payout_card GROUP BY status ORDER BY status`,
        ),
      ).toEqual([
        { status: 'ACTIVE', n: 1 },
        { status: 'REMOVED', n: 1 },
      ]);
      await payouts.removeCard({ affiliateId: '42' });
      expect((await payouts.card({ affiliateId: '42' })).card).toBeNull();
    });

    it('sessiya bir martalik, takror hodisa va noto‘g‘ri niqob tashlanadi', async () => {
      const ref = await bindCard('42', '1234');
      // shu sessiya bilan ikkinchi karta — rad (boshqa birov hodisani takrorlasa ham)
      await payouts.onCardBound({
        eventId: 'card-again',
        sessionRef: ref,
        tokenCipher: sealPayoutToken('tok_other_123456', KEY),
        mask: '8600 **** **** 5555',
        system: null,
        holderName: null,
      });
      await payouts.createSession({ affiliateId: '42' });
      const [{ ref: next }] = (await ds.query(
        `SELECT ref::text FROM finance.payout_card_session WHERE used_at IS NULL`,
      )) as Array<{ ref: string }>;
      for (const mask of ['8600123412341234', '8600 12** **** 1234'])
        await payouts.onCardBound({
          eventId: `bad-${mask}`,
          sessionRef: next,
          tokenCipher: sealPayoutToken('tok_other_123456', KEY),
          mask,
          system: null,
          holderName: null,
        });
      // boshqa kalit bilan shifrlangan token — ochilmaydi
      await payouts.onCardBound({
        eventId: 'bad-key',
        sessionRef: next,
        tokenCipher: sealPayoutToken('tok_other_123456', 'x'.repeat(40)),
        mask: '8600 **** **** 7777',
        system: null,
        holderName: null,
      });
      expect((await payouts.card({ affiliateId: '42' })).card?.mask).toBe(
        '8600 **** **** 1234',
      );
    });

    it('provayder sozlanmagan — sessiya 503, kartaga yuborilmaydi (qo‘lda «To‘landi» ishlaydi)', async () => {
      await bindCard();
      env.PAYOUT_API_URL = '';
      provider.isConfigured.mockImplementation(() => false);
      expect((await payouts.card({ affiliateId: '42' })).enabled).toBe(false);
      await expect(
        payouts.createSession({ affiliateId: '42' }),
      ).rejects.toMatchObject({ status: 503 });
      const id = await approved();
      expect(await payouts.tick()).toEqual({ sent: 0, checked: 0 });
      expect(provider.send).not.toHaveBeenCalled();
      const paid = await withdrawals.markPaid({ id, paidBy: '7' });
      expect(paid).toMatchObject({
        status: WithdrawalStatus.PAID,
        payoutMode: WithdrawalPayoutMode.MANUAL,
        cardMask: null,
      });
    });
  });

  describe('to‘lov', () => {
    it('TC1: tasdiqlangan so‘rov → kartaga net summa → «To‘landi», jurnal, «Pul o‘tkazildi» xabari', async () => {
      await bindCard();
      const id = await approved();
      provider.send.mockResolvedValue({ status: 'SUCCESS', reason: null });
      expect(await payouts.tick()).toEqual({ sent: 1, checked: 0 });
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(provider.send.mock.calls[0][0]).toMatchObject({
        payoutRef: `wd-${id}`,
        cardToken: `${TOKEN}-42-1234`,
        amount: 990_000,
      });
      const w = await withdrawals.one({ id });
      expect(w).toMatchObject({
        status: WithdrawalStatus.PAID,
        payoutMode: WithdrawalPayoutMode.CARD,
        cardMask: '8600 **** **** 1234',
        paidBy: SYSTEM_PAYER,
        failReason: null,
      });
      expect(w.payoutSentAt).not.toBeNull();
      expect(await balance()).toMatchObject({ available: 0, reserved: 0 });
      expect(emitted).toEqual([
        {
          pattern: 'finance.withdrawal.paid',
          payload: {
            withdrawalId: id,
            affiliateId: '42',
            amount: 1_000_000,
            tax: 10_000,
            net: 990_000,
          },
        },
      ]);
      // ikkinchi yurish — qayta yuborilmaydi
      await payouts.tick();
      expect(provider.send).toHaveBeenCalledTimes(1);
      await expectBalanced();
    });

    it('TC2: provayder rad etdi → FAILED, ledgerda yozuv yo‘q, pul «Mavjud» da, o‘sha kuni yangi so‘rov mumkin', async () => {
      await bindCard();
      const id = await approved();
      provider.send.mockResolvedValue({
        status: 'FAILED',
        reason: 'Karta bloklangan',
      });
      await payouts.tick();
      expect(await withdrawals.one({ id })).toMatchObject({
        status: WithdrawalStatus.FAILED,
        failReason: 'Karta bloklangan',
        payoutMode: WithdrawalPayoutMode.CARD,
        paidAt: null,
      });
      expect(await balance()).toMatchObject({
        available: 1_000_000,
        reserved: 0,
        withdrawable: 1_000_000,
        blockReason: null,
      });
      expect(
        Number(
          (
            await ds.query(
              `SELECT count(*)::int AS n FROM finance.journal WHERE kind = 'WITHDRAWAL_PAID'`,
            )
          )[0].n,
        ),
      ).toBe(0);
      expect(emitted).toEqual([
        {
          pattern: WITHDRAWAL_FAILED_EVENT,
          payload: {
            withdrawalId: id,
            affiliateId: '42',
            amount: 1_000_000,
            net: 990_000,
            cardMask: '8600 **** **** 1234',
            reason: 'Karta bloklangan',
          },
        },
      ]);
      const again = await withdrawals.create({
        affiliateId: '42',
        amount: 500_000,
      });
      expect(again.status).toBe(WithdrawalStatus.REQUESTED);
      await expectBalanced();
    });

    it('TC2: 4xx yoki ulanib bo‘lmadi (PayoutRejectedError) → FAILED, sabab bilan', async () => {
      await bindCard();
      const id = await approved();
      provider.send.mockRejectedValue(
        new PayoutRejectedError('provayder HTTP 422: token eskirgan', 422),
      );
      await payouts.tick();
      expect(await withdrawals.one({ id })).toMatchObject({
        status: WithdrawalStatus.FAILED,
        failReason: 'provayder HTTP 422: token eskirgan',
      });
      expect((await balance()).available).toBe(1_000_000);
    });

    it('javob noma’lum → PAYING, qayta yuborilmaydi, qo‘lda «To‘landi»/rad 409; holat so‘rovi SUCCESS → «To‘landi»', async () => {
      await bindCard();
      const id = await approved();
      provider.send.mockRejectedValue(
        new PayoutUnknownError('provayder 10 soniyada javob bermadi'),
      );
      await payouts.tick();
      expect((await withdrawals.one({ id })).status).toBe(
        WithdrawalStatus.PAYING,
      );
      expect(await balance()).toMatchObject({
        available: 1_000_000,
        reserved: 1_000_000,
        withdrawable: 0,
      });
      await expect(
        withdrawals.markPaid({ id, paidBy: '7' }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        withdrawals.reject({ id, rejectedBy: '7', reason: 'x' }),
      ).rejects.toMatchObject({ status: 409 });
      // hali 1 daqiqa o‘tmagan — holat so‘ralmaydi
      expect(await payouts.tick()).toEqual({ sent: 0, checked: 0 });
      await ageSent(id);
      provider.status.mockResolvedValueOnce(null); // provayder bilmaydi — baribir qayta yuborilmaydi
      expect(await payouts.tick()).toEqual({ sent: 0, checked: 1 });
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect((await withdrawals.one({ id })).status).toBe(
        WithdrawalStatus.PAYING,
      );
      await ds.query(
        `UPDATE finance.withdrawal_request SET payout_checked_at = now() - interval '2 minutes' WHERE id = $1`,
        [id],
      );
      provider.status.mockResolvedValueOnce({
        status: 'SUCCESS',
        reason: null,
      });
      await payouts.tick();
      expect(provider.status).toHaveBeenLastCalledWith(`wd-${id}`);
      expect(await withdrawals.one({ id })).toMatchObject({
        status: WithdrawalStatus.PAID,
        paidBy: SYSTEM_PAYER,
      });
      expect(provider.send).toHaveBeenCalledTimes(1);
      await expectBalanced();
    });

    it('PENDING → webhook payout.status SUCCESS → «To‘landi»; takror hodisa bir marta', async () => {
      await bindCard();
      const id = await approved();
      provider.send.mockResolvedValue({ status: 'PENDING', reason: null });
      await payouts.tick();
      expect((await withdrawals.one({ id })).status).toBe(
        WithdrawalStatus.PAYING,
      );
      const ev = {
        eventId: 'pay-1',
        payoutRef: `wd-${id}`,
        status: 'SUCCESS' as const,
        reason: null,
      };
      await payouts.onStatus(ev);
      await payouts.onStatus(ev);
      expect((await withdrawals.one({ id })).status).toBe(
        WithdrawalStatus.PAID,
      );
      expect(
        emitted.filter((e) => e.pattern === 'finance.withdrawal.paid'),
      ).toHaveLength(1);
      // «To‘landi» dan keyin kelgan FAILED — holat o‘zgarmaydi
      await payouts.onStatus({ ...ev, eventId: 'pay-2', status: 'FAILED' });
      expect((await withdrawals.one({ id })).status).toBe(
        WithdrawalStatus.PAID,
      );
      await expectBalanced();
    });

    it('moliya PAYING ni qo‘lda yopadi: FAILED (izoh) yoki PAID; boshqa holatda 409', async () => {
      await bindCard();
      const id = await approved();
      provider.send.mockRejectedValue(new PayoutUnknownError('vaqt tugadi'));
      await payouts.tick();
      await expect(
        payouts.resolve({ id, result: 'FAILED', note: ' ', actorId: '7' }),
      ).rejects.toMatchObject({ status: 400 });
      const failed = await payouts.resolve({
        id,
        result: 'FAILED',
        note: 'Provayder kabinetida to‘lov yo‘q',
        actorId: '7',
      });
      expect(failed).toMatchObject({
        status: WithdrawalStatus.FAILED,
        failReason: 'Provayder kabinetida to‘lov yo‘q',
      });
      await expect(
        payouts.resolve({ id, result: 'PAID', note: 'x', actorId: '7' }),
      ).rejects.toMatchObject({ status: 409 });

      const id2 = (
        await withdrawals.create({ affiliateId: '42', amount: 200_000 })
      ).id;
      await withdrawals.approve({
        id: id2,
        approverId: '7',
        currentFullName: 'Sotuvchi',
      });
      await payouts.tick();
      const paid = await payouts.resolve({
        id: id2,
        result: 'PAID',
        note: 'Provayder kabinetida: o‘tgan',
        actorId: '8',
      });
      expect(paid).toMatchObject({
        status: WithdrawalStatus.PAID,
        paidBy: '8',
        payoutMode: WithdrawalPayoutMode.CARD,
      });
      expect((await balance()).available).toBe(800_000);
      await expectBalanced();
    });

    it('karta yo‘q yoki balans yetmaydi — «Tasdiqlandi» da qoladi, yuborilmaydi', async () => {
      const id = await approved();
      expect(await payouts.tick()).toEqual({ sent: 0, checked: 0 });
      expect((await withdrawals.one({ id })).status).toBe(
        WithdrawalStatus.APPROVED,
      );
      await bindCard();
      // balans kamaydi (masalan qaytarish) — yuborilmaydi, soatda bir qayta ko‘riladi
      await ds.query(
        `UPDATE finance.account SET available_balance = 100 WHERE type = 'AFFILIATE' AND owner_id = '42'`,
      );
      expect((await payouts.tick()).sent).toBe(0);
      expect(provider.send).not.toHaveBeenCalled();
      const [{ checked }] = (await ds.query(
        `SELECT payout_checked_at IS NOT NULL AS checked FROM finance.withdrawal_request WHERE id = $1`,
        [id],
      )) as Array<{ checked: boolean }>;
      expect(checked).toBe(true);
    });

    it('TC3: bazada karta raqami ham, ochiq token ham yo‘q — faqat niqob va shifrlangan token', async () => {
      await bindCard();
      await approved();
      provider.send.mockResolvedValue({ status: 'SUCCESS', reason: null });
      await payouts.tick();
      const columns = (await ds.query(
        `SELECT table_name AS t, column_name AS c FROM information_schema.columns
          WHERE table_schema = 'finance' AND table_name <> 'migrations'
            AND data_type IN ('character varying', 'text', 'character', 'jsonb', 'json')`,
      )) as Array<{ t: string; c: string }>;
      const values: string[] = [];
      for (const { t, c } of columns) {
        const rows = (await ds.query(
          `SELECT "${c}"::text AS v FROM finance."${t}" WHERE "${c}" IS NOT NULL`,
        )) as Array<{ v: string }>;
        for (const { v } of rows)
          if (!c.endsWith('_cipher')) values.push(v);
          else expect(v).not.toContain('tok_');
      }
      const dump = values.join('\n');
      expect(dump).not.toMatch(/\d{12,19}/);
      expect(dump).not.toContain(TOKEN);
      expect(dump).toContain('8600 **** **** 1234');
    });

    it('24 soat (T01:498): ochiq so‘rov — moliyaga bir marta xabar', async () => {
      const id = await approved();
      expect(await payouts.overdue()).toBe(0);
      await ds.query(
        `UPDATE finance.withdrawal_request SET created_at = now() - interval '25 hours' WHERE id = $1`,
        [id],
      );
      expect(await payouts.overdue()).toBe(1);
      expect(await payouts.overdue()).toBe(0);
      expect(emitted).toEqual([
        {
          pattern: WITHDRAWAL_OVERDUE_EVENT,
          payload: {
            withdrawals: [
              expect.objectContaining({
                id,
                affiliateId: '42',
                amount: 1_000_000,
                status: WithdrawalStatus.APPROVED,
              }),
            ],
          },
        },
      ]);
    });
  });
});
