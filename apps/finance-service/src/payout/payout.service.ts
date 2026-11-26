import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  ErrorCode,
  moneyFromDb,
  openPayoutToken,
  openPinfl,
  PAYOUT_REF,
  payoutKey,
  PayoutCardBoundEvent,
  PayoutCardInfoDto,
  PayoutCardSessionDto,
  PayoutCardSystem,
  PayoutStatusEvent,
  RmqClient,
  runAsLeader,
  WITHDRAWAL_FAILED_EVENT,
  WITHDRAWAL_OVERDUE_EVENT,
  WithdrawalDto,
  WithdrawalFailedEvent,
  WithdrawalOverdueEvent,
  WithdrawalPayoutMode,
  WithdrawalStatus,
  CARD_MASK,
} from '@app/common';
import {
  affiliatePayoutLock,
  selfEmployedGate,
  validId,
} from '../ledger/payout-gate';
import { RequestRow, WithdrawalService } from '../ledger/withdrawal.service';
import {
  PayoutProvider,
  PayoutRejectedError,
  PayoutResult,
  PayoutUnknownError,
} from './payout.provider';

/** Kartani ulash sessiyasi — 15 daqiqa [taklif; Multicard bind sessiyasi 15 daqiqa — EQ-08]. */
export const CARD_SESSION_MINUTES = 15;
/** Bir yurishda yuboriladigan so‘rovlar [taklif]. */
const BATCH = 20;
/** Yuborishdan keyin holat shuncha vaqtdan so‘ng so‘raladi va keyin shu oraliqda [taklif]. */
const POLL_AFTER = `interval '1 minute'`;
/** Yuborib bo‘lmagan (maqom, balans) tasdiqlangan so‘rov shu oraliqda qayta ko‘riladi [taklif]. */
const RETRY_SKIPPED = `interval '1 hour'`;
/** T01:498: «Pul yechish muddati: so‘rovdan to‘lovgacha … ≤ 24 soat». */
const OVERDUE = `interval '24 hours'`;
/** Avtomatik to‘lovda `paid_by`. */
export const SYSTEM_PAYER = 'system:payout';
const CONSUMER = 'payout-webhook';
const LOCK = 'finance-payout';
const ZONE = 'Asia/Tashkent';

const state = (message: string) =>
  new ConflictException({ message, errorCode: ErrorCode.INVALID_STATE });

export const PAYOUT_NOT_CONFIGURED = 'PAYOUT_NOT_CONFIGURED';
export const PAYOUT_FAILED = 'PAYOUT_FAILED';

interface CardRow {
  id: string;
  mask: string;
  system: PayoutCardSystem | null;
  holderName: string | null;
  boundAt: Date;
  tokenCipher: string;
}

/**
 * BE-32 (TZ MOL-6, T02:85): sotuvchi kartasiga pul o‘tkazish — provayderga bog‘liq bo‘lmagan yadro.
 * - Karta provayder sahifasida ulanadi; bizda shifrlangan token va niqob. To‘liq raqam hech qachon kelmaydi.
 * - Tasdiqlangan so‘rov (BE-23) — `PAYING` → provayder: muvaffaqiyat — «To‘landi» (BE-23 jurnali), rad — `FAILED`
 *   (ledgerda yozuv yo‘q, pul «Mavjud» da; MOL-6), noma’lum — `PAYING` da qoladi, holat so‘raladi, qayta yuborilmaydi.
 * - Provayder sozlanmagan yoki sotuvchida karta yo‘q — so‘rov «Tasdiqlandi» da, moliya qo‘lda (BE-23).
 * - 24 soatdan beri to‘lanmagan so‘rov — moliyaga bir marta xabar (T01:498).
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly provider: PayoutProvider,
    private readonly withdrawals: WithdrawalService,
    @Inject(RmqClient.NOTIFICATION) private readonly notifications: ClientProxy,
  ) {}

  /** Provayder ham, token kaliti ham bor — kartaga to‘lov yoqilgan. */
  enabled(): boolean {
    return this.provider.isConfigured() && payoutKey(this.config) !== null;
  }

  // ---------- Karta ----------

  async card(input: { affiliateId: string }): Promise<PayoutCardInfoDto> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    const card = await this.activeCard(this.db.manager, affiliateId);
    return {
      enabled: this.enabled(),
      card: card
        ? {
            mask: card.mask,
            system: card.system,
            holderName: card.holderName,
            boundAt: card.boundAt,
          }
        : null,
    };
  }

  /** Provayder sahifasi havolasi — sotuvchi kartani o‘sha yerda kiritadi (bizga karta raqami kelmaydi). */
  async createSession(input: {
    affiliateId: string;
  }): Promise<PayoutCardSessionDto> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    if (!this.enabled())
      throw new ServiceUnavailableException({
        message:
          'Kartani ulash hali yoqilmagan — pul moliya tomonidan o‘tkaziladi',
        errorCode: PAYOUT_NOT_CONFIGURED,
      });
    const ref = randomUUID();
    const [{ expiresAt }] = (await this.db.query(
      `INSERT INTO finance.payout_card_session (ref, affiliate_id, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3))
       RETURNING expires_at AS "expiresAt"`,
      [ref, affiliateId, CARD_SESSION_MINUTES],
    )) as Array<{ expiresAt: Date }>;
    let url: string;
    try {
      ({ url } = await this.provider.createCardSession({
        sessionRef: ref,
        returnUrl: this.config.get<string>('PAYOUT_RETURN_URL')?.trim() || null,
        pinfl: await this.verifiedPinfl(affiliateId),
      }));
    } catch (error) {
      this.logger.warn(
        `Karta sessiyasi ochilmadi (${affiliateId}): ${(error as Error)?.message}`,
      );
      throw new BadGatewayException({
        message:
          'Karta sahifasini ochib bo‘lmadi — birozdan so‘ng urinib ko‘ring',
        errorCode: PAYOUT_FAILED,
      });
    }
    return { url, expiresAt };
  }

  /** Kartani o‘chirish. Yuborilgan (`PAYING`) so‘rovlarga ta’sir qilmaydi — ularda karta nusxasi bor. */
  async removeCard(input: { affiliateId: string }): Promise<PayoutCardInfoDto> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    await this.db.transaction(async (m) => {
      await affiliatePayoutLock(m, affiliateId);
      await m.query(
        `UPDATE finance.payout_card SET status = 'REMOVED', removed_at = now()
          WHERE affiliate_id = $1 AND status = 'ACTIVE'`,
        [affiliateId],
      );
    });
    return this.card({ affiliateId });
  }

  /** Webhook `card.bound` (gateway token ni shifrlab yuboradi). Sessiya bir martalik; yangi karta eskisi o‘rniga. */
  async onCardBound(event: PayoutCardBoundEvent): Promise<void> {
    const key = payoutKey(this.config);
    if (!key) throw new Error('PAYOUT_SECRET_KEY sozlanmagan');
    const mask = String(event?.mask ?? '');
    const system =
      event?.system && Object.values(PayoutCardSystem).includes(event.system)
        ? event.system
        : null;
    if (
      !event?.eventId ||
      !event.sessionRef ||
      !CARD_MASK.test(mask) ||
      !event.tokenCipher ||
      event.tokenCipher.length > 700 ||
      !openPayoutToken(event.tokenCipher, key)
    ) {
      this.logger.warn(
        `Karta hodisasi tashlandi (${event?.eventId}): maydonlar yoki token noto‘g‘ri`,
      );
      return;
    }
    await this.db.transaction(async (m) => {
      if (!(await this.firstTime(m, event.eventId))) return;
      const [session] = (await m.query(
        `SELECT affiliate_id AS "affiliateId", used_at AS "usedAt", expires_at < now() AS expired
           FROM finance.payout_card_session WHERE ref = $1 FOR UPDATE`,
        [event.sessionRef],
      )) as Array<{
        affiliateId: string;
        usedAt: Date | null;
        expired: boolean;
      }>;
      // provayder sahifasi 15 daqiqa ochiq — kartani shu ichida kiritgan bo‘lsa ham hodisa kechikib kelishi mumkin:
      // muddat sessiyani ochishga taalluqli, hodisa tekshiruvi imzo va bir martalik bilan [taklif]
      if (!session || session.usedAt) {
        this.logger.warn(
          `Karta hodisasi (${event.eventId}): sessiya ${session ? 'ishlatilgan' : 'topilmadi'}`,
        );
        return;
      }
      await affiliatePayoutLock(m, session.affiliateId);
      await m.query(
        `UPDATE finance.payout_card SET status = 'REMOVED', removed_at = now()
          WHERE affiliate_id = $1 AND status = 'ACTIVE'`,
        [session.affiliateId],
      );
      await m.query(
        `INSERT INTO finance.payout_card (affiliate_id, token_cipher, mask, system, holder_name, session_ref)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.affiliateId,
          event.tokenCipher,
          mask,
          system,
          event.holderName
            ? String(event.holderName).trim().slice(0, 120) || null
            : null,
          event.sessionRef,
        ],
      );
      await m.query(
        `UPDATE finance.payout_card_session SET used_at = now() WHERE ref = $1`,
        [event.sessionRef],
      );
    });
  }

  // ---------- To‘lov ----------

  @Cron('0 * * * * *', { name: 'finance-payout', timeZone: ZONE })
  async cron(): Promise<void> {
    if (!this.enabled()) return;
    await runAsLeader(this.db, LOCK, () => this.tick());
  }

  /** Bitta yurish: yangi tasdiqlanganlarni yuborish va javobsizlarning holatini so‘rash. */
  async tick(): Promise<{ sent: number; checked: number }> {
    let sent = 0;
    let checked = 0;
    if (!this.enabled()) return { sent, checked };
    const ready = (await this.db.query(
      `SELECT r.id::text FROM finance.withdrawal_request r
         JOIN finance.payout_card c ON c.affiliate_id = r.affiliate_id AND c.status = 'ACTIVE'
        WHERE r.status = 'APPROVED'
          AND (r.payout_checked_at IS NULL OR r.payout_checked_at < now() - ${RETRY_SKIPPED})
        ORDER BY r.approved_at, r.id LIMIT ${BATCH}`,
    )) as Array<{ id: string }>;
    for (const { id } of ready)
      if (await this.dispatch(id).catch((error) => this.logError(id, error)))
        sent++;
    const waiting = (await this.db.query(
      `SELECT id::text FROM finance.withdrawal_request
        WHERE status = 'PAYING' AND payout_sent_at < now() - ${POLL_AFTER}
          AND (payout_checked_at IS NULL OR payout_checked_at < now() - ${POLL_AFTER})
        ORDER BY payout_sent_at, id LIMIT ${BATCH * 2}`,
    )) as Array<{ id: string }>;
    for (const { id } of waiting) {
      await this.poll(id).catch((error) => this.logError(id, error));
      checked++;
    }
    return { sent, checked };
  }

  /**
   * Tasdiqlangan so‘rovni kartaga yuborish. Qulf ostida qayta tekshiriladi (tasdiqlar, maqom, mavjud balans) va
   * `PAYING` qilinadi — faqat shundan keyin provayderga so‘rov ketadi. Qaytadi: yuborildimi.
   */
  async dispatch(id: string): Promise<boolean> {
    const key = payoutKey(this.config);
    if (!key || !this.provider.isConfigured()) return false;
    const prepared = await this.db.transaction(async (m) => {
      const head = await this.withdrawals.head(m, id);
      await affiliatePayoutLock(m, head.affiliateId);
      const row = await this.withdrawals.lockRow(m, id);
      if (row.status !== WithdrawalStatus.APPROVED) return null;
      const skip = async (why: string) => {
        this.logger.warn(`So‘rov ${id} kartaga yuborilmadi: ${why}`);
        await m.query(
          `UPDATE finance.withdrawal_request SET payout_checked_at = now() WHERE id = $1`,
          [id],
        );
        return null;
      };
      const [{ n }] = (await m.query(
        `SELECT count(*)::int AS n FROM finance.withdrawal_approval WHERE request_id = $1`,
        [id],
      )) as Array<{ n: number }>;
      if (n < row.requiredApprovals) return skip('tasdiqlar yetmaydi');
      if (!(await selfEmployedGate(m, row.affiliateId)))
        return skip('maqom tasdiqlanmagan');
      const [{ available }] = (await m.query(
        `SELECT COALESCE((SELECT available_balance FROM finance.account
                           WHERE type = 'AFFILIATE' AND owner_id = $1), 0)::text AS available`,
        [row.affiliateId],
      )) as Array<{ available: string }>;
      if (moneyFromDb(available) < moneyFromDb(row.amount))
        return skip('mavjud balans yetmaydi — moliya qaror qiladi');
      const card = await this.activeCard(m, row.affiliateId);
      if (!card) return null;
      const token = openPayoutToken(card.tokenCipher, key);
      if (!token)
        return skip('karta tokenini ochib bo‘lmadi (kalit almashganmi?)');
      const payoutRef = `wd-${id}`;
      await m.query(
        `UPDATE finance.withdrawal_request
            SET status = 'PAYING', payout_mode = 'CARD', payout_card_id = $2, card_token_cipher = $3,
                card_mask = $4, payout_ref = $5, payout_sent_at = now(), payout_checked_at = NULL, updated_at = now()
          WHERE id = $1`,
        [id, card.id, card.tokenCipher, card.mask, payoutRef],
      );
      return { payoutRef, token, net: moneyFromDb(row.netAmount) };
    });
    if (!prepared) return false;
    let result: PayoutResult;
    try {
      result = await this.provider.send({
        payoutRef: prepared.payoutRef,
        cardToken: prepared.token,
        amount: prepared.net,
        purpose: `Elchi: sotuvchi haqi, so‘rov ${id}`,
      });
    } catch (error) {
      if (error instanceof PayoutRejectedError) {
        await this.fail(id, error.message);
        return true;
      }
      // noma’lum: pul ketgan bo‘lishi mumkin — `PAYING` da qoladi, holat so‘raladi, qayta yuborilmaydi
      this.logger.warn(
        `So‘rov ${id}: provayder javobi noma’lum (${(error as Error)?.message}) — holat so‘raladi`,
      );
      return true;
    }
    await this.apply(id, result);
    return true;
  }

  /** `PAYING` holatini provayderdan so‘rash. Topilmasa ham qayta yuborilmaydi — moliya qo‘lda yopadi. */
  async poll(id: string): Promise<void> {
    const [row] = (await this.db.query(
      `SELECT payout_ref AS "payoutRef" FROM finance.withdrawal_request WHERE id = $1 AND status = 'PAYING'`,
      [id],
    )) as Array<{ payoutRef: string }>;
    if (!row) return;
    let result: PayoutResult | null = null;
    try {
      result = await this.provider.status(row.payoutRef);
    } catch (error) {
      if (!(error instanceof PayoutUnknownError)) throw error;
      this.logger.warn(
        `So‘rov ${id}: holat so‘rovi o‘tmadi — ${error.message}`,
      );
    }
    if (result) await this.apply(id, result);
    await this.db.query(
      `UPDATE finance.withdrawal_request SET payout_checked_at = now() WHERE id = $1 AND status = 'PAYING'`,
      [id],
    );
  }

  /** Webhook `payout.status`. Takror hodisa — bir marta. */
  async onStatus(event: PayoutStatusEvent): Promise<void> {
    if (
      !event?.eventId ||
      !PAYOUT_REF.test(String(event.payoutRef ?? '')) ||
      !['SUCCESS', 'PENDING', 'FAILED'].includes(event.status)
    ) {
      this.logger.warn(`To‘lov hodisasi tashlandi (${event?.eventId})`);
      return;
    }
    const fresh = await this.db.transaction((m) =>
      this.firstTime(m, event.eventId),
    );
    if (!fresh) return;
    const [row] = (await this.db.query(
      `SELECT id::text FROM finance.withdrawal_request WHERE payout_ref = $1`,
      [event.payoutRef],
    )) as Array<{ id: string }>;
    if (!row) {
      this.logger.warn(`To‘lov hodisasi: ${event.payoutRef} topilmadi`);
      return;
    }
    await this.apply(row.id, {
      status: event.status,
      reason: event.reason ? String(event.reason).slice(0, 300) : null,
    });
  }

  /**
   * Moliya `PAYING` dagi so‘rovni provayder kabinetida tekshirib yopadi (izoh majburiy; audit — gateway).
   * `PAID` — jurnal, `FAILED` — pul «Mavjud» da qoladi.
   */
  async resolve(input: {
    id: string;
    result: 'PAID' | 'FAILED';
    note: string;
    actorId: string;
  }): Promise<WithdrawalDto> {
    const id = validId(input?.id, 'id');
    const actorId = validId(input?.actorId, 'actorId');
    const note = String(input?.note ?? '').trim();
    if (!note || note.length > 500)
      throw new BadRequestException('note: 1–500 belgi');
    if (input?.result !== 'PAID' && input?.result !== 'FAILED')
      throw new BadRequestException('result: PAID yoki FAILED');
    const event = await this.db.transaction(async (m) => {
      const head = await this.withdrawals.head(m, id);
      await affiliatePayoutLock(m, head.affiliateId);
      const row = await this.withdrawals.lockRow(m, id);
      if (row.status !== WithdrawalStatus.PAYING)
        throw state(
          `So‘rov ${row.status} holatida — natija faqat kartaga yuborilgan so‘rovga kiritiladi`,
        );
      await m.query(
        `UPDATE finance.withdrawal_request SET payout_resolved_by = $2, payout_note = $3 WHERE id = $1`,
        [id, actorId, note],
      );
      return input.result === 'PAID'
        ? this.markPaid(m, row, actorId)
        : this.markFailed(m, row, note);
    });
    this.emit(event);
    return this.withdrawals.get(this.db.manager, id);
  }

  /** T01:498: 24 soatdan beri to‘lanmagan ochiq so‘rovlar — moliyaga bir marta (qo‘lda yo‘lda ham). */
  @Cron('0 5 * * * *', { name: 'finance-withdrawal-overdue', timeZone: ZONE })
  async overdueCron(): Promise<void> {
    await runAsLeader(this.db, `${LOCK}-overdue`, () => this.overdue());
  }

  async overdue(): Promise<number> {
    const rows = (await this.db.query(
      `WITH marked AS (
         UPDATE finance.withdrawal_request
          SET overdue_notified_at = now()
        WHERE status IN ('REQUESTED', 'APPROVED', 'PAYING')
          AND created_at < now() - ${OVERDUE} AND overdue_notified_at IS NULL
        RETURNING id::text, affiliate_id AS "affiliateId", amount::text, status, created_at AS "createdAt")
       SELECT * FROM marked`,
    )) as Array<{
      id: string;
      affiliateId: string;
      amount: string;
      status: WithdrawalStatus;
      createdAt: Date;
    }>;
    if (!rows.length) return 0;
    const event: WithdrawalOverdueEvent = {
      withdrawals: rows
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map((r) => ({
          id: r.id,
          affiliateId: r.affiliateId,
          amount: moneyFromDb(r.amount),
          status: r.status,
          createdAt: new Date(r.createdAt).toISOString(),
        })),
    };
    this.emit({ pattern: WITHDRAWAL_OVERDUE_EVENT, payload: event });
    return rows.length;
  }

  // ---------- ichki ----------

  /** Provayder natijasi: SUCCESS — «To‘landi», FAILED — `FAILED`, PENDING — kutiladi. Faqat `PAYING` dan. */
  private async apply(id: string, result: PayoutResult): Promise<void> {
    if (result.status === 'SUCCESS') await this.complete(id);
    else if (result.status === 'FAILED')
      await this.fail(id, result.reason || 'provayder to‘lovni rad etdi');
  }

  private async complete(id: string): Promise<void> {
    const event = await this.db.transaction(async (m) => {
      const head = await this.withdrawals.head(m, id);
      await affiliatePayoutLock(m, head.affiliateId);
      const row = await this.withdrawals.lockRow(m, id);
      if (row.status === WithdrawalStatus.PAID) return null;
      if (row.status !== WithdrawalStatus.PAYING) {
        // masalan, moliya «o‘tmadi» deb yopgan, provayder esa «o‘tdi» dedi — pul ketgan: qo‘lda hal qilinadi
        this.logger.error(
          `So‘rov ${id}: provayder «to‘landi» dedi, holat ${row.status} — moliya tekshirsin`,
        );
        return null;
      }
      return this.markPaid(m, row, SYSTEM_PAYER);
    });
    this.emit(event);
  }

  private async fail(id: string, reason: string): Promise<void> {
    const event = await this.db.transaction(async (m) => {
      const head = await this.withdrawals.head(m, id);
      await affiliatePayoutLock(m, head.affiliateId);
      const row = await this.withdrawals.lockRow(m, id);
      if (row.status !== WithdrawalStatus.PAYING) return null;
      return this.markFailed(m, row, reason);
    });
    this.emit(event);
  }

  private async markPaid(m: EntityManager, row: RequestRow, paidBy: string) {
    await this.withdrawals.writePaid(m, row, paidBy, WithdrawalPayoutMode.CARD);
    // BE-24: «Pul o‘tkazildi» SMS (notification `dedupeKey` — qo‘lda yo‘l bilan bir xil)
    return {
      pattern: 'finance.withdrawal.paid',
      payload: {
        withdrawalId: row.id,
        affiliateId: row.affiliateId,
        amount: moneyFromDb(row.amount),
        tax: moneyFromDb(row.taxAmount),
        net: moneyFromDb(row.netAmount),
      },
    };
  }

  private async markFailed(m: EntityManager, row: RequestRow, reason: string) {
    const text = reason.trim().slice(0, 500) || 'provayder to‘lovni rad etdi';
    await m.query(
      `UPDATE finance.withdrawal_request
          SET status = 'FAILED', fail_reason = $2, failed_at = now(), updated_at = now()
        WHERE id = $1`,
      [row.id, text],
    );
    const [{ mask }] = (await m.query(
      `SELECT card_mask AS mask FROM finance.withdrawal_request WHERE id = $1`,
      [row.id],
    )) as Array<{ mask: string | null }>;
    const payload: WithdrawalFailedEvent = {
      withdrawalId: row.id,
      affiliateId: row.affiliateId,
      amount: moneyFromDb(row.amount),
      net: moneyFromDb(row.netAmount),
      cardMask: mask,
      reason: text,
    };
    return { pattern: WITHDRAWAL_FAILED_EVENT, payload };
  }

  private emit(event: { pattern: string; payload: unknown } | null): void {
    if (!event) return;
    this.notifications.emit(event.pattern, event.payload).subscribe({
      error: (error: Error) =>
        this.logger.warn(
          `Xabar yuborilmadi (${event.pattern}): ${error?.message}`,
        ),
    });
  }

  private async activeCard(
    m: EntityManager,
    affiliateId: string,
  ): Promise<CardRow | null> {
    const [card] = (await m.query(
      `SELECT id::text, mask, system, holder_name AS "holderName", bound_at AS "boundAt", token_cipher AS "tokenCipher"
         FROM finance.payout_card WHERE affiliate_id = $1 AND status = 'ACTIVE'`,
      [affiliateId],
    )) as CardRow[];
    return card ?? null;
  }

  /** Tasdiqlangan JShShIR — provayder karta egasini tekshiradi (EQ-08 `pinfl`) [taklif]; kalit yoki ariza yo‘q — null. */
  private async verifiedPinfl(affiliateId: string): Promise<string | null> {
    const key = this.config.get<string>('SELF_EMPLOYED_SECRET_KEY')?.trim();
    if (!key) return null;
    const [row] = (await this.db.query(
      `SELECT pinfl_cipher AS cipher FROM finance.self_employed_application
        WHERE affiliate_id = $1 AND status = 'VERIFIED' AND pinfl_cipher IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
      [affiliateId],
    )) as Array<{ cipher: string }>;
    return row ? openPinfl(row.cipher, key) : null;
  }

  private async firstTime(m: EntityManager, eventId: string): Promise<boolean> {
    const inserted = (await m.query(
      `INSERT INTO finance.processed_event (consumer, event_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING event_id`,
      [CONSUMER, String(eventId).slice(0, 200)],
    )) as unknown[];
    return inserted.length > 0;
  }

  private logError(id: string, error: unknown): false {
    this.logger.error(
      `So‘rov ${id}: kartaga to‘lovda xato — ${(error as Error)?.message}`,
    );
    return false;
  }
}
