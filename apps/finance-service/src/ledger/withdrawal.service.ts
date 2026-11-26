import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import {
  AdminWithdrawalQueryDto,
  AffiliateBalanceDto,
  ErrorCode,
  MAX_MONEY,
  moneyFromDb,
  payoutEnabled,
  WithdrawalBlockReason,
  WithdrawalDto,
  WithdrawalPageDto,
  WithdrawalPayoutMode,
  WithdrawalQueryDto,
  WithdrawalStatus,
} from '@app/common';
import { Line, LedgerService } from './ledger.service';
import {
  affiliatePayoutLock,
  assertPayable,
  selfEmployedGate,
  validId,
} from './payout-gate';

/** Ushlanadigan soliq — 1% (BE-23 kartasi; TZ 8-bo‘lim). */
export const WITHDRAWAL_TAX_PERCENT = 1;
/** Bundan katta so‘rov — ikki xil xodim tasdig‘i (MOL-5: «5 mln dan katta»). */
export const TWO_APPROVALS_ABOVE = 5_000_000;
/** Band summa — ochiq so‘rovlar (BE-32: kartaga yuborilgani ham, natijasi kelguncha). */
export const OPEN: WithdrawalStatus[] = [
  WithdrawalStatus.REQUESTED,
  WithdrawalStatus.APPROVED,
  WithdrawalStatus.PAYING,
];
/** Rad etish mumkin — kartaga yuborilgan (`PAYING`) so‘rov emas: pul ketgan bo‘lishi mumkin. */
const REJECTABLE: WithdrawalStatus[] = [
  WithdrawalStatus.REQUESTED,
  WithdrawalStatus.APPROVED,
];
/** Kunni band qilmaydigan holatlar: rad etilgan va kartaga o‘tmagan (BE-32 [taklif]) — sotuvchi yangi so‘rov yuboradi. */
const NOT_COUNTED = `('REJECTED', 'FAILED')`;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const TODAY = `(now() AT TIME ZONE 'Asia/Tashkent')::date`;

/** 1% soliq, butun so‘m, yuqoriga yaxlitlab — soliq kam ushlanmasin [taklif; EQ-10 buxgalter]. */
export function withdrawalTax(amount: number): number {
  return Math.ceil((amount * WITHDRAWAL_TAX_PERCENT) / 100);
}

const rule = (message: string) =>
  new BadRequestException({
    message,
    errorCode: ErrorCode.BUSINESS_RULE_VIOLATION,
  });
const state = (message: string) =>
  new ConflictException({ message, errorCode: ErrorCode.INVALID_STATE });

export interface RequestRow {
  id: string;
  affiliateId: string;
  amount: string;
  taxAmount: string;
  netAmount: string;
  status: WithdrawalStatus;
  requiredApprovals: number;
  rejectReason: string | null;
  createdAt: Date;
  paidAt: Date | null;
  paidBy: string | null;
  payoutMode: WithdrawalPayoutMode | null;
  cardMask: string | null;
  payoutSentAt: Date | null;
  failReason: string | null;
  failedAt: Date | null;
  payoutConflict: string | null;
}

const SELECT = `SELECT r.id::text, r.affiliate_id AS "affiliateId", r.amount::text, r.tax_amount::text AS "taxAmount",
       r.net_amount::text AS "netAmount", r.status, r.required_approvals AS "requiredApprovals",
       r.reject_reason AS "rejectReason", r.created_at AS "createdAt", r.paid_at AS "paidAt", r.paid_by AS "paidBy",
       r.payout_mode AS "payoutMode", r.card_mask AS "cardMask", r.payout_sent_at AS "payoutSentAt",
       r.fail_reason AS "failReason", r.failed_at AS "failedAt", r.payout_conflict AS "payoutConflict"
  FROM finance.withdrawal_request r`;

/**
 * BE-23: sotuvchining pul yechish so‘rovlari (MOL-5, SOT-7). To‘lov qo‘lda: moliya kartaga o‘tkazib «To‘landi»
 * belgilaydi (avtomatik — BE-32).
 * - So‘rovda ledgerga yozilmaydi: ochiq so‘rovlar (So‘raldi, Tasdiqlandi) summasi «band», yechish mumkin =
 *   mavjud − band (dizayn: summa «To‘landi» gacha «Mavjud» da turadi, DZ-07).
 * - «To‘landi» da bitta jurnal: AFFILIATE −summa, TAX +1% soliq (alohida qator — qabul mezoni),
 *   COD_CLEARING +kartaga o‘tgan pul (platformadagi naqd kamayadi) [taklif hisob].
 * - Kuniga 1 so‘rov (Toshkent kuni, rad etilgani hisobga olinmaydi), kamida `withdrawal_min` (50 000),
 *   5 mln dan katta — ikki xil xodim tasdig‘i, o‘zini o‘zi band qilganlik belgisi bo‘lmasa — rad (T01:471).
 */
@Injectable()
export class WithdrawalService {
  constructor(
    private readonly db: DataSource,
    private readonly ledger: LedgerService,
    // BE-32: kartaga avtomatik to‘lov yoqilganmi (`autoPayout`); yo‘q bo‘lsa — o‘chiq
    @Optional() private readonly config?: ConfigService,
  ) {}

  /**
   * BE-32: sotuvchi hisobidan hali yechilmagan, lekin kartaga yuborilgan (`PAYING`) pulni ayirgan mavjud summa. Sotuvchi
   * hisobi qulflanadi — bir vaqtda ikki to‘lov bir summani ikki marta hisoblamaydi. Chaqiruvchi sotuvchi qulfini olgan.
   */
  async spendable(
    m: EntityManager,
    affiliateId: string,
    excludeId: string,
  ): Promise<number> {
    const aff = await this.ledger.accountId(m, 'AFFILIATE', affiliateId);
    // «To‘landi» jurnali qulflaydigan hisoblarning hammasi birdan (tartiblangan) — qulf tartibi buzilmasin
    await this.ledger.lockAccounts(m, [
      aff,
      await this.ledger.accountId(m, 'TAX', ''),
      await this.ledger.accountId(m, 'COD_CLEARING', ''),
    ]);
    const [{ available, paying }] = (await m.query(
      `SELECT (SELECT available_balance FROM finance.account WHERE id = $1)::text AS available,
              (SELECT COALESCE(SUM(amount), 0) FROM finance.withdrawal_request
                WHERE affiliate_id = $2 AND status = 'PAYING' AND id <> $3)::text AS paying`,
      [aff, affiliateId, excludeId],
    )) as Array<{ available: string; paying: string }>;
    return moneyFromDb(available) - moneyFromDb(paying);
  }

  /** BE-32: tasdiqlangan so‘rov kartaga avtomatik ketadimi (yoqilgan va sotuvchida faol karta bor). */
  private async autoPayoutAffiliates(
    m: EntityManager,
    affiliateIds: string[],
  ): Promise<Set<string>> {
    if (!this.config || !payoutEnabled(this.config) || !affiliateIds.length)
      return new Set();
    const rows = (await m.query(
      `SELECT affiliate_id AS "affiliateId" FROM finance.payout_card
        WHERE status = 'ACTIVE' AND affiliate_id = ANY($1::text[])`,
      [affiliateIds],
    )) as Array<{ affiliateId: string }>;
    return new Set(rows.map((r) => r.affiliateId));
  }

  private async minAmount(m: EntityManager): Promise<number> {
    const [row] = (await m.query(
      `SELECT value FROM finance.setting
        WHERE key = 'withdrawal_min' AND effective_from <= now()
        ORDER BY effective_from DESC LIMIT 1`,
    )) as Array<{ value: string }>;
    if (!row) throw new Error('withdrawal_min sozlamasi yo‘q');
    return moneyFromDb(row.value);
  }

  private async snapshot(m: EntityManager, affiliateId: string) {
    const [acc] = (await m.query(
      `SELECT hold_balance::text AS hold, available_balance::text AS available
         FROM finance.account WHERE type = 'AFFILIATE' AND owner_id = $1`,
      [affiliateId],
    )) as Array<{ hold: string; available: string }>;
    // Band — faqat ochiq so‘rovlar; bugungi kun — rad etilmagan har qanday so‘rov (to‘langani ham kunni band qiladi)
    const [res] = (await m.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE status = ANY($2::text[])), 0)::text AS reserved,
              COALESCE(bool_or(request_day = ${TODAY}), false) AS today
         FROM finance.withdrawal_request
        WHERE affiliate_id = $1 AND status NOT IN ${NOT_COUNTED}`,
      [affiliateId, OPEN],
    )) as Array<{ reserved: string; today: boolean }>;
    const available = moneyFromDb(acc?.available);
    const reserved = moneyFromDb(res.reserved);
    return {
      hold: moneyFromDb(acc?.hold),
      available,
      reserved,
      withdrawable: Math.max(0, available - reserved),
      selfEmployed: await selfEmployedGate(m, affiliateId),
      todayRequested: res.today === true,
    };
  }

  /** Kabinet: balans va so‘rov yuborish mumkinmi (FE-07). */
  async balance(input: { affiliateId: string }): Promise<AffiliateBalanceDto> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    const m = this.db.manager;
    const s = await this.snapshot(m, affiliateId);
    const minAmount = await this.minAmount(m);
    return {
      hold: s.hold,
      available: s.available,
      reserved: s.reserved,
      withdrawable: s.withdrawable,
      minAmount,
      taxPercent: WITHDRAWAL_TAX_PERCENT,
      twoApprovalAbove: TWO_APPROVALS_ABOVE,
      selfEmployed: s.selfEmployed,
      blockReason: !s.selfEmployed
        ? WithdrawalBlockReason.NOT_SELF_EMPLOYED
        : s.todayRequested
          ? WithdrawalBlockReason.DAILY_LIMIT
          : s.withdrawable < minAmount
            ? WithdrawalBlockReason.BELOW_MIN
            : null,
    };
  }

  /** Sotuvchi so‘rovi (SOT-7). TC2 min, TC3 kunlik, TC5 maqom — so‘rov yaratilmaydi. */
  async create(input: {
    affiliateId: string;
    amount: number;
  }): Promise<WithdrawalDto> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    const amount = input?.amount;
    if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > MAX_MONEY
    )
      throw new BadRequestException('amount: butun so‘m bo‘lishi kerak');
    const id = await this.db.transaction(async (m) => {
      await affiliatePayoutLock(m, affiliateId);
      const min = await this.minAmount(m);
      if (amount < min)
        throw rule(`Eng kam so‘rov — ${min} so‘m (so‘ralgani ${amount})`);
      const s = await this.snapshot(m, affiliateId);
      if (!s.selfEmployed)
        throw rule(
          'O‘zini o‘zi band qilganlik maqomi tasdiqlanmagan — to‘lov qilinmaydi (T01:471)',
        );
      if (s.todayRequested)
        throw rule('Bugun so‘rov yuborilgan: kuniga bitta so‘rov');
      if (amount > s.withdrawable)
        throw rule(
          `Yechish mumkin bo‘lgan summa ${s.withdrawable} so‘m — so‘ralgani ${amount}`,
        );
      const tax = withdrawalTax(amount);
      try {
        const [row] = (await m.query(
          `INSERT INTO finance.withdrawal_request
             (affiliate_id, amount, tax_amount, net_amount, required_approvals, request_day)
           VALUES ($1, $2, $3, $4, $5, ${TODAY})
           RETURNING id::text`,
          [
            affiliateId,
            amount,
            tax,
            amount - tax,
            amount > TWO_APPROVALS_ABOVE ? 2 : 1,
          ],
        )) as Array<{ id: string }>;
        return row.id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw rule('Bugun so‘rov yuborilgan: kuniga bitta so‘rov');
        throw err;
      }
    });
    return this.get(this.db.manager, id);
  }

  async listMine(input: {
    affiliateId: string;
    query: WithdrawalQueryDto;
  }): Promise<WithdrawalPageDto> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    const page = await this.page(input?.query ?? {}, affiliateId);
    // ziddiyat matni — moliya uchun (BE-32)
    return {
      ...page,
      items: page.items.map((i) => ({ ...i, payoutConflict: null })),
    };
  }

  /** Moliya ro‘yxati (FE-20). */
  async adminList(input: {
    query: AdminWithdrawalQueryDto;
  }): Promise<WithdrawalPageDto> {
    const q = input?.query ?? {};
    const affiliateId = q.affiliateId
      ? validId(q.affiliateId, 'affiliateId')
      : null;
    return this.page(q, affiliateId);
  }

  private async page(
    q: WithdrawalQueryDto,
    affiliateId: string | null,
  ): Promise<WithdrawalPageDto> {
    if (
      q.status !== undefined &&
      !Object.values(WithdrawalStatus).includes(q.status)
    )
      throw new BadRequestException('status noto‘g‘ri');
    const page = Math.max(1, Math.trunc(Number(q.page)) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.trunc(Number(q.limit)) || DEFAULT_LIMIT),
    );
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset))
      throw new BadRequestException('page juda katta');
    const where = `($1::text IS NULL OR r.affiliate_id = $1) AND ($2::text IS NULL OR r.status = $2)`;
    const params = [affiliateId, q.status ?? null];
    const [{ total }] = (await this.db.query(
      `SELECT count(*)::int AS total FROM finance.withdrawal_request r WHERE ${where}`,
      params,
    )) as Array<{ total: number }>;
    const rows = (await this.db.query(
      `${SELECT} WHERE ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT $3 OFFSET $4`,
      [...params, limit, offset],
    )) as RequestRow[];
    return {
      items: await this.toDtos(this.db.manager, rows),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Tasdiq (MOL-5). 5 mln dan katta so‘rov ikki xil xodim tasdig‘idan keyin «Tasdiqlandi» bo‘ladi;
   * bir xodim ikkinchi marta tasdiqlay olmaydi (TC4). Pul shundan keyin o‘tkaziladi — maqom va ism shu yerda
   * tekshiriladi (BE-25 5-tur).
   */
  async approve(input: {
    id: string;
    approverId: string;
    /** Sotuvchining hozirgi ism-familiyasi (identity). */
    currentFullName: string;
  }): Promise<WithdrawalDto> {
    const id = validId(input?.id, 'id');
    const approverId = validId(input?.approverId, 'approverId');
    await this.db.transaction(async (m) => {
      const head = await this.head(m, id);
      await affiliatePayoutLock(m, head.affiliateId);
      const row = await this.lockRow(m, id);
      if (row.status !== WithdrawalStatus.REQUESTED)
        throw state(`So‘rov ${row.status} holatida — tasdiqlab bo‘lmaydi`);
      await assertPayable(m, row.affiliateId, input.currentFullName);
      const inserted = (await m.query(
        `INSERT INTO finance.withdrawal_approval (request_id, approver_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING request_id`,
        [id, approverId],
      )) as unknown[];
      if (!inserted.length)
        throw state(
          'Bu so‘rovni siz tasdiqlagansiz — ikkinchi tasdiqni boshqa xodim beradi',
        );
      const [{ n }] = (await m.query(
        `SELECT count(*)::int AS n FROM finance.withdrawal_approval WHERE request_id = $1`,
        [id],
      )) as Array<{ n: number }>;
      if (n >= row.requiredApprovals)
        await m.query(
          `UPDATE finance.withdrawal_request SET status = 'APPROVED', approved_at = now(), updated_at = now()
            WHERE id = $1`,
          [id],
        );
    });
    return this.get(this.db.manager, id);
  }

  /** Rad etish (sabab bilan). Ledgerga yozuv yo‘q — band summa bo‘shaydi. */
  async reject(input: {
    id: string;
    rejectedBy: string;
    reason: string;
  }): Promise<WithdrawalDto> {
    const id = validId(input?.id, 'id');
    const rejectedBy = validId(input?.rejectedBy, 'rejectedBy');
    const reason = String(input?.reason ?? '').trim();
    if (!reason || reason.length > 500)
      throw new BadRequestException('reason: 1–500 belgi');
    await this.db.transaction(async (m) => {
      const row = await this.lockRow(m, id);
      if (row.status === WithdrawalStatus.PAYING)
        throw state(
          'So‘rov kartaga yuborilgan — natija provayderdan keladi; tekshirib bo‘lgach «Natijani kiritish»',
        );
      if (!REJECTABLE.includes(row.status))
        throw state(`So‘rov ${row.status} holatida — rad etib bo‘lmaydi`);
      await m.query(
        `UPDATE finance.withdrawal_request
            SET status = 'REJECTED', reject_reason = $2, rejected_by = $3, rejected_at = now(), updated_at = now()
          WHERE id = $1`,
        [id, reason, rejectedBy],
      );
    });
    return this.get(this.db.manager, id);
  }

  /**
   * «To‘landi» (moliya kartaga qo‘lda o‘tkazdi). Faqat «Tasdiqlandi» dan (TC4); takror bosilsa — o‘sha natija.
   * Maqom va mavjud balans shu paytda qayta tekshiriladi (qaytarishdan keyin balans kamaygan bo‘lishi mumkin).
   */
  async markPaid(input: {
    id: string;
    paidBy: string;
  }): Promise<WithdrawalDto> {
    const id = validId(input?.id, 'id');
    const paidBy = validId(input?.paidBy, 'paidBy');
    await this.db.transaction(async (m) => {
      const head = await this.head(m, id);
      await affiliatePayoutLock(m, head.affiliateId);
      const row = await this.lockRow(m, id);
      if (row.status === WithdrawalStatus.PAID) {
        // kartaga avtomatik to‘langanini qo‘lda ham o‘tkazib qo‘ymasin: jim 200 emas, aniq javob
        if (row.payoutMode === WithdrawalPayoutMode.CARD)
          throw state('So‘rov kartaga avtomatik to‘langan — qo‘lda o‘tkazmang');
        return; // takror bosildi
      }
      if (row.status === WithdrawalStatus.PAYING)
        throw state(
          'So‘rov kartaga yuborilgan — natija provayderdan keladi; tekshirib bo‘lgach «Natijani kiritish»',
        );
      if (row.status !== WithdrawalStatus.APPROVED)
        throw state(
          `So‘rov ${row.status} holatida — «To‘landi» faqat tasdiqlangandan keyin`,
        );
      const [{ n }] = (await m.query(
        `SELECT count(*)::int AS n FROM finance.withdrawal_approval WHERE request_id = $1`,
        [id],
      )) as Array<{ n: number }>;
      if (n < row.requiredApprovals)
        throw state(`Tasdiqlar yetmaydi: ${n}/${row.requiredApprovals}`);
      if (!(await selfEmployedGate(m, row.affiliateId)))
        throw rule(
          'O‘zini o‘zi band qilganlik maqomi tasdiqlanmagan — to‘lov qilinmaydi (T01:471)',
        );
      if (
        (await this.autoPayoutAffiliates(m, [row.affiliateId])).has(
          row.affiliateId,
        )
      )
        throw state(
          'So‘rov kartaga avtomatik yuboriladi — qo‘lda «To‘landi» yo‘q (sotuvchi kartani o‘chirsa — qo‘lda)',
        );
      const amount = moneyFromDb(row.amount);
      const spendable = await this.spendable(m, row.affiliateId, id);
      if (spendable < amount)
        throw state(
          `Mavjud balans yetmaydi: ${spendable} so‘m (kartaga yuborilayotganlardan keyin), so‘rov ${amount} — rad eting yoki kuting`,
        );
      await this.writePaid(m, row, paidBy, WithdrawalPayoutMode.MANUAL);
    });
    return this.get(this.db.manager, id);
  }

  /**
   * «To‘landi» jurnali va holati (qo‘lda — `markPaid`; kartaga — BE-32 `PayoutService`). Chaqiruvchi so‘rov qatorini va
   * sotuvchi qulfini allaqachon olgan. Kartaga yuborilganda balans yuborishdan oldin tekshirilgan — pul ketgan, shuning
   * uchun bu yerda qayta rad etilmaydi.
   */
  async writePaid(
    m: EntityManager,
    row: Pick<
      RequestRow,
      'id' | 'affiliateId' | 'amount' | 'taxAmount' | 'netAmount'
    >,
    paidBy: string,
    mode: WithdrawalPayoutMode,
    accountsLocked = false,
  ): Promise<void> {
    const id = row.id;
    const amount = moneyFromDb(row.amount);
    const tax = moneyFromDb(row.taxAmount);
    const net = moneyFromDb(row.netAmount);
    if (!accountsLocked)
      await this.ledger.lockAccounts(m, [
        await this.ledger.accountId(m, 'AFFILIATE', row.affiliateId),
        await this.ledger.accountId(m, 'TAX', ''),
        await this.ledger.accountId(m, 'COD_CLEARING', ''),
      ]);
    const reference = `withdrawal:${id}`;
    const lines: Line[] = [
      {
        account: 'AFFILIATE',
        ownerId: row.affiliateId,
        lineKind: 'WITHDRAWAL',
        itemSeq: 0,
        productId: null,
        amount: -amount,
      },
      {
        account: 'TAX',
        ownerId: '',
        lineKind: 'WITHDRAWAL_TAX',
        itemSeq: 0,
        productId: null,
        amount: tax,
      },
      {
        account: 'COD_CLEARING',
        ownerId: '',
        lineKind: 'WITHDRAWAL_NET',
        itemSeq: 0,
        productId: null,
        amount: net,
      },
    ].filter((l) => l.amount !== 0) as Line[];
    const journalId = await this.ledger.writeJournal(
      m,
      {
        kind: 'WITHDRAWAL_PAID',
        referenceId: reference,
        orderId: null,
        affiliateId: row.affiliateId,
        eventId: reference,
        occurredAt: new Date().toISOString(),
        gross: amount,
      },
      lines,
      'AVAILABLE',
    );
    if (!journalId)
      throw new Error(
        `withdrawal ${id}: jurnal allaqachon bor, holat PAID emas`,
      );
    await m.query(
      `UPDATE finance.withdrawal_request
            SET status = 'PAID', paid_by = $2, paid_at = now(), journal_id = $3, payout_mode = $4, updated_at = now()
          WHERE id = $1`,
      [id, paidBy, journalId, mode],
    );
  }

  /** Bitta so‘rov (gateway tasdiqdan oldin sotuvchini biladi). */
  async one(input: { id: string }): Promise<WithdrawalDto> {
    return this.get(this.db.manager, validId(input?.id, 'id'));
  }

  async head(m: EntityManager, id: string): Promise<{ affiliateId: string }> {
    const [head] = (await m.query(
      `SELECT affiliate_id AS "affiliateId" FROM finance.withdrawal_request WHERE id = $1`,
      [id],
    )) as Array<{ affiliateId: string }>;
    if (!head) throw new NotFoundException('So‘rov topilmadi');
    return head;
  }

  async lockRow(m: EntityManager, id: string): Promise<RequestRow> {
    const [row] = (await m.query(`${SELECT} WHERE r.id = $1 FOR UPDATE`, [
      id,
    ])) as RequestRow[];
    if (!row) throw new NotFoundException('So‘rov topilmadi');
    return row;
  }

  async get(m: EntityManager, id: string): Promise<WithdrawalDto> {
    const [row] = (await m.query(`${SELECT} WHERE r.id = $1`, [
      id,
    ])) as RequestRow[];
    if (!row) throw new NotFoundException('So‘rov topilmadi');
    return (await this.toDtos(m, [row]))[0];
  }

  private async toDtos(
    m: EntityManager,
    rows: RequestRow[],
  ): Promise<WithdrawalDto[]> {
    if (!rows.length) return [];
    const approvals = (await m.query(
      `SELECT request_id::text AS "requestId", approver_id AS "approvedBy", created_at AS "approvedAt"
         FROM finance.withdrawal_approval WHERE request_id = ANY($1::bigint[])
        ORDER BY created_at, approver_id`,
      [rows.map((r) => r.id)],
    )) as Array<{ requestId: string; approvedBy: string; approvedAt: Date }>;
    const auto = await this.autoPayoutAffiliates(m, [
      ...new Set(
        rows
          .filter((r) => r.status === WithdrawalStatus.APPROVED)
          .map((r) => r.affiliateId),
      ),
    ]);
    return rows.map((r) => ({
      id: r.id,
      affiliateId: r.affiliateId,
      amount: moneyFromDb(r.amount),
      taxAmount: moneyFromDb(r.taxAmount),
      netAmount: moneyFromDb(r.netAmount),
      status: r.status,
      requiredApprovals: r.requiredApprovals,
      approvals: approvals
        .filter((a) => a.requestId === r.id)
        .map((a) => ({ approvedBy: a.approvedBy, approvedAt: a.approvedAt })),
      rejectReason: r.rejectReason,
      createdAt: r.createdAt,
      paidAt: r.paidAt,
      paidBy: r.paidBy,
      payoutMode: r.payoutMode ?? null,
      cardMask: r.cardMask ?? null,
      payoutSentAt: r.payoutSentAt ?? null,
      failReason: r.failReason ?? null,
      failedAt: r.failedAt ?? null,
      autoPayout:
        r.status === WithdrawalStatus.APPROVED && auto.has(r.affiliateId),
      payoutConflict: r.payoutConflict ?? null,
    }));
  }
}
