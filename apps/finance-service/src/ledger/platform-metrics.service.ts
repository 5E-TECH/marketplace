import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  moneyFromDb,
  PlatformAffiliateIncomeQuery,
  PlatformAffiliateIncomeResult,
  PlatformFinanceMetricsDto,
  PlatformFinanceMetricsRowDto,
} from '@app/common';
import { remittanceOrdersSql, validRange } from './remittance.service';

const TASHKENT_DAY = (col: string) =>
  `to_char((${col} AT TIME ZONE 'Asia/Tashkent')::date, 'YYYY-MM-DD')`;
const RANGE = (col: string) =>
  `${col} >= ($1::date)::timestamp AT TIME ZONE 'Asia/Tashkent'
   AND ${col} < ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Tashkent'`;

type Part = {
  share: number;
  sales: number;
  diff: number;
  withdrawal: number | null;
};

/**
 * BE-46: TZ 9-bo‘lim ko‘rsatkichlarining moliya qismi (10–12-qatorlar), kun bo‘yicha (Toshkent).
 * - platformShare — PLATFORM_SERVICE hisobi yozuvlari yig‘indisi (yetkazilgan, rad to‘lovi, qaytarish ko‘zgusi),
 *   jurnal kuni bo‘yicha; contributionPerSale = platformShare / shu kuni yetkazilgan buyurtmalar [taklif, savol 1];
 * - reconciliationDiff — Elchi sverkasining hal qilinmagan farqi (buyurtma bo‘yicha, Elchi − tizim), buyurtmaning
 *   oxirgi o‘tkazmasi kelgan kuni;
 * - withdrawalMedianHours — so‘rovdan to‘lovgacha, shu kuni to‘langan so‘rovlar mediani, soat (1 kasr).
 */
@Injectable()
export class PlatformMetricsService {
  constructor(private readonly dataSource: DataSource) {}

  async platform(input: {
    from?: string;
    to?: string;
  }): Promise<PlatformFinanceMetricsDto> {
    const [from, to] = validRange(input?.from, input?.to);

    const parts = new Map<string, Part>();
    const part = (key: string) => {
      let p = parts.get(key);
      if (!p) {
        p = { share: 0, sales: 0, diff: 0, withdrawal: null };
        parts.set(key, p);
      }
      return p;
    };
    for (const key of ['TOTAL', ...dayKeys(from, to)]) part(key);

    // Kun bo‘yicha va jami — GROUPING SETS bilan bitta so‘rovda (median ham to‘g‘ri chiqadi).
    const shares = (await this.dataSource.query(
      `SELECT COALESCE(${TASHKENT_DAY('j.occurred_at')}, 'TOTAL') AS key,
              COALESCE(SUM(e.amount), 0)::text AS share
         FROM finance.journal j
         JOIN finance.ledger_entry e ON e.journal_id = j.id
         JOIN finance.account a ON a.id = e.account_id
        WHERE a.type = 'PLATFORM_SERVICE'
          AND j.kind IN ('ORDER_DELIVERED', 'ORDER_REFUSED', 'ORDER_REVERSAL')
          AND ${RANGE('j.occurred_at')}
        GROUP BY GROUPING SETS ((${TASHKENT_DAY('j.occurred_at')}), ())`,
      [from, to],
    )) as Array<{ key: string; share: string }>;
    for (const r of shares) part(r.key).share = moneyFromDb(r.share);

    const sales = (await this.dataSource.query(
      `SELECT COALESCE(${TASHKENT_DAY('j.occurred_at')}, 'TOTAL') AS key,
              COUNT(DISTINCT j.order_id)::int AS sales
         FROM finance.journal j
        WHERE j.kind = 'ORDER_DELIVERED' AND ${RANGE('j.occurred_at')}
        GROUP BY GROUPING SETS ((${TASHKENT_DAY('j.occurred_at')}), ())`,
      [from, to],
    )) as Array<{ key: string; sales: number }>;
    for (const r of sales) part(r.key).sales = Number(r.sales);

    // Sverka farqi buyurtma bo‘yicha, buyurtmaning oxirgi o‘tkazma kunida — sverka ekrani bilan bir xil hisob
    // (remittance.service); har buyurtma bir marta, jami = kunlar yig‘indisi.
    const diffs = (await this.dataSource.query(
      `SELECT COALESCE(to_char(day, 'YYYY-MM-DD'), 'TOTAL') AS key, COALESCE(SUM(view_diff), 0)::text AS diff
         FROM (${remittanceOrdersSql()}) v WHERE view_state = 'DIFF'
        GROUP BY GROUPING SETS ((day), ())`,
      [from, to],
    )) as Array<{ key: string; diff: string }>;
    for (const r of diffs) part(r.key).diff = moneyFromDb(r.diff);

    const withdrawals = (await this.dataSource.query(
      `SELECT COALESCE(${TASHKENT_DAY('w.paid_at')}, 'TOTAL') AS key,
              percentile_cont(0.5) WITHIN GROUP
                (ORDER BY EXTRACT(EPOCH FROM (w.paid_at - w.created_at)) / 3600) AS hours
         FROM finance.withdrawal_request w
        WHERE w.status = 'PAID' AND ${RANGE('w.paid_at')}
        GROUP BY GROUPING SETS ((${TASHKENT_DAY('w.paid_at')}), ())`,
      [from, to],
    )) as Array<{ key: string; hours: string | number | null }>;
    for (const r of withdrawals)
      part(r.key).withdrawal =
        r.hours === null ? null : Math.round(Number(r.hours) * 10) / 10;

    const row = (key: string): PlatformFinanceMetricsRowDto => {
      const p = parts.get(key)!;
      return {
        key,
        contributionPerSale: p.sales ? Math.round(p.share / p.sales) : null,
        platformShare: p.share,
        reconciliationDiff: p.diff,
        withdrawalMedianHours: p.withdrawal,
      };
    };
    return {
      rows: dayKeys(from, to).map(row),
      totals: row('TOTAL'),
    };
  }

  /**
   * Sotuvchi daromadi (9-bo‘lim, EPC) — BE-28 `finance.affiliate.income` bilan bir xil qoida: AFFILIATE hisobidagi
   * sotuvchi haqi va ustama ulushi; yetkazilgan kunda asl yozuv (+), qaytarilgan kunda ko‘zgu yozuv (−). Asosiy sayt
   * sotuvida bu qatorlar platformaga yoziladi — kirmaydi. Kalit: kun (Toshkent), sotuvchi yoki mahsulot (offer).
   */
  async affiliateIncome(
    input: PlatformAffiliateIncomeQuery,
  ): Promise<PlatformAffiliateIncomeResult> {
    const [from, to] = validRange(input?.from, input?.to);
    const key =
      input?.groupBy === 'DAY'
        ? TASHKENT_DAY('j.occurred_at')
        : input?.groupBy === 'AFFILIATE'
          ? 'a.owner_id'
          : input?.groupBy === 'OFFER'
            ? `COALESCE(e.product_id, '')`
            : null;
    if (!key) throw new BadRequestException('groupBy noto‘g‘ri');
    const rows = (await this.dataSource.query(
      `SELECT CASE WHEN GROUPING(k) = 1 THEN NULL ELSE k END AS key, COALESCE(SUM(amount), 0)::text AS amount
         FROM (
           SELECT ${key} AS k, e.amount
             FROM finance.account a
             JOIN finance.ledger_entry e ON e.account_id = a.id
             JOIN finance.journal j ON j.id = e.journal_id
            WHERE a.type = 'AFFILIATE' AND e.line_kind IN ${AFFILIATE_LINES}
              AND ((j.kind = 'ORDER_DELIVERED' AND e.reverses_entry_id IS NULL) OR j.kind = 'ORDER_REVERSAL')
              AND ${RANGE('j.occurred_at')}
         ) x
        GROUP BY GROUPING SETS ((k), ())`,
      [from, to],
    )) as Array<{ key: string | null; amount: string }>;
    let total = 0;
    const out: PlatformAffiliateIncomeResult['rows'] = [];
    for (const r of rows) {
      if (r.key === null) total = moneyFromDb(r.amount);
      else out.push({ key: r.key, amount: moneyFromDb(r.amount) });
    }
    return { rows: out.sort((a, b) => a.key.localeCompare(b.key)), total };
  }
}

/** Sotuvchi qatorlari — BE-28 `affiliateIncome` bilan bir xil (ledger-query.service). */
const AFFILIATE_LINES = `('AFFILIATE_FEE', 'AFFILIATE_MARKUP')`;

function dayKeys(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  )
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
