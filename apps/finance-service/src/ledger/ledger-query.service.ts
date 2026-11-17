import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  FinanceAffiliateIncomeLine,
  FinanceAffiliateIncomeQuery,
  FinanceAffiliateIncomeResult,
  moneyFromDb,
} from '@app/common';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,19}$/;
/** Sotuvchi qatorlari: sotuvchi haqi va ustamaning sotuvchi ulushi (split.ts). */
const AFFILIATE_LINES = `('AFFILIATE_FEE', 'AFFILIATE_MARKUP')`;
/** Jurnal kuni — Toshkent (TZ 02:184). */
const TASHKENT_DAY = (col: string) =>
  `to_char((${col} AT TIME ZONE 'Asia/Tashkent')::date, 'YYYY-MM-DD')`;

function validDay(value: unknown, field: string): string {
  const s = String(value ?? '');
  const d = new Date(`${s}T00:00:00Z`);
  if (
    !DAY.test(s) ||
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== s
  )
    throw new BadRequestException(`${field}: YYYY-MM-DD sana kerak`);
  return s;
}

/** BE-22 o'qish so'rovlari: hisoblar balansi va buyurtma taqsimoti (BE-28, BE-41 uchun). */
@Injectable()
export class LedgerQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async accounts(type?: string) {
    const rows = (await this.dataSource.query(
      `SELECT id::text, type, NULLIF(owner_id, '') AS "ownerId",
              hold_balance AS "hold", available_balance AS "available"
         FROM finance.account WHERE ($1::text IS NULL OR type = $1) ORDER BY id`,
      [type ?? null],
    )) as Array<Record<string, string>>;
    return rows.map((r) => ({
      ...r,
      hold: moneyFromDb(r.hold),
      available: moneyFromDb(r.available),
    }));
  }

  async orderSplit(orderId: string) {
    const rows = (await this.dataSource.query(
      `SELECT j.kind AS "journal", e.line_kind AS "lineKind", a.type AS "account",
              NULLIF(a.owner_id, '') AS "ownerId", e.item_seq AS "itemSeq",
              e.product_id AS "productId", e.amount, e.state
         FROM finance.journal j
         JOIN finance.ledger_entry e ON e.journal_id = j.id
         JOIN finance.account a ON a.id = e.account_id
        WHERE j.order_id = $1
        ORDER BY j.id, e.id`,
      [orderId],
    )) as Array<Record<string, string>>;
    return rows.map((r) => ({ ...r, amount: moneyFromDb(r.amount) }));
  }

  /**
   * Sotuvchi daromadi ledgerdan (BE-28; BE-22 dizayni «finance.affiliate.income»).
   * - davr bo‘yicha: shu kunlarda yetkazilgan buyurtmalarning asl yozuvlari (+) va shu kunlarda
   *   qaytarilganlarning ko‘zgu yozuvlari (−); ustun asl yozuv AVAILABLE ga o‘tgan-o‘tmaganiga qarab;
   * - `leadIds` bo‘yicha: shu lidlarning asl yozuvlari hozirgi holati bilan (davrsiz).
   * Faqat AFFILIATE hisobi (egasi = sotuvchi): asosiy sayt sotuvida shu qatorlar platformaga yoziladi (split.ts).
   */
  async affiliateIncome(
    query: FinanceAffiliateIncomeQuery,
  ): Promise<FinanceAffiliateIncomeResult> {
    const affiliateId = String(query?.affiliateId ?? '');
    if (!ID.test(affiliateId))
      throw new BadRequestException('affiliateId noto‘g‘ri');
    const delivered = (where: string) => `
      SELECT j.lead_id AS "leadId", j.order_id AS "orderId", 'DELIVERED' AS kind,
             ${TASHKENT_DAY('j.occurred_at')} AS day,
             CASE WHEN bool_or(e.available_at IS NOT NULL) THEN 'AVAILABLE' ELSE 'HOLD' END AS "column",
             SUM(e.amount)::text AS amount, MAX(e.state) AS state
        FROM finance.account a
        JOIN finance.ledger_entry e ON e.account_id = a.id
        JOIN finance.journal j ON j.id = e.journal_id
       WHERE a.type = 'AFFILIATE' AND a.owner_id = $1
         AND j.kind = 'ORDER_DELIVERED' AND e.reverses_entry_id IS NULL
         AND e.line_kind IN ${AFFILIATE_LINES}
         AND ${where}
       GROUP BY j.id`;
    let rows: Array<Record<string, string>>;
    if (query.leadIds !== undefined) {
      if (
        !Array.isArray(query.leadIds) ||
        !query.leadIds.every((x) => ID.test(String(x)))
      )
        throw new BadRequestException('leadIds noto‘g‘ri');
      if (!query.leadIds.length) return { lines: [] };
      rows = (await this.dataSource.query(
        `${delivered('j.lead_id = ANY($2::text[])')} ORDER BY 1, 2`,
        [affiliateId, query.leadIds.map(String)],
      )) as Array<Record<string, string>>;
    } else {
      const from = validDay(query.from, 'from');
      const to = validDay(query.to, 'to');
      if (from > to) throw new BadRequestException('from > to');
      const range = (col: string) =>
        `${col} >= ($2::date)::timestamp AT TIME ZONE 'Asia/Tashkent'
         AND ${col} < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Tashkent'`;
      rows = (await this.dataSource.query(
        `${delivered(range('j.occurred_at'))}
         UNION ALL
         SELECT oj.lead_id, oj.order_id, 'REVERSAL',
                ${TASHKENT_DAY('rj.occurred_at')},
                CASE WHEN bool_or(o.available_at IS NOT NULL) THEN 'AVAILABLE' ELSE 'HOLD' END,
                SUM(m.amount)::text, MAX(o.state)
           FROM finance.account a
           JOIN finance.ledger_entry m ON m.account_id = a.id
           JOIN finance.journal rj ON rj.id = m.journal_id
           JOIN finance.ledger_entry o ON o.id = m.reverses_entry_id
           JOIN finance.journal oj ON oj.id = o.journal_id
          WHERE a.type = 'AFFILIATE' AND a.owner_id = $1
            AND rj.kind = 'ORDER_REVERSAL' AND m.line_kind IN ${AFFILIATE_LINES}
            AND ${range('rj.occurred_at')}
          GROUP BY rj.id, oj.id
          ORDER BY 4, 2, 3`,
        [affiliateId, from, to],
      )) as Array<Record<string, string>>;
    }
    return {
      lines: rows.map((r): FinanceAffiliateIncomeLine => ({
        leadId: r.leadId ?? null,
        orderId: r.orderId,
        kind: r.kind as FinanceAffiliateIncomeLine['kind'],
        day: r.day,
        column: r.column as FinanceAffiliateIncomeLine['column'],
        amount: moneyFromDb(r.amount),
        state: r.state as FinanceAffiliateIncomeLine['state'],
      })),
    };
  }
}
