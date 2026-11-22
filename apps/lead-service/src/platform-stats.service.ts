import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import {
  LeadStatus,
  PLATFORM_METRICS_RPC,
  PlatformAffiliateIncomeResult,
  PlatformLeadMetricsDto,
  PlatformLeadMetricsRowDto,
  PlatformMetricsGroupBy,
  RmqClient,
  sendRpc,
} from '@app/common';
import { tashkentDayStart } from './lead-schedule';
import { percent } from './offer-math';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Yaroqsiz va dublikat — «yaroqli» ga kirmaydi (TZ 01:489; BE-28 bilan bir xil). */
const NOT_VALID = [LeadStatus.INVALID, LeadStatus.MERGED];
const TOTAL = 'TOTAL';
/** Davr chegarasi [taklif]: bir so‘rovda ko‘pi bilan bir yil. */
const MAX_DAYS = 366;

type Counts = Record<
  | 'clicks'
  | 'leads'
  | 'invalid'
  | 'duplicates'
  | 'validLeads'
  | 'noContact'
  | 'attempts'
  | 'worked'
  | 'confirmed'
  | 'delivered'
  | 'refused'
  | 'goodsTotal'
  | 'income',
  number
> & { firstCall: number | null };

const empty = (): Counts => ({
  clicks: 0,
  leads: 0,
  invalid: 0,
  duplicates: 0,
  validLeads: 0,
  noContact: 0,
  attempts: 0,
  worked: 0,
  confirmed: 0,
  delivered: 0,
  refused: 0,
  goodsTotal: 0,
  income: 0,
  firstCall: null,
});

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

/**
 * Admin ko‘rsatkichlari lid-servis qismi (BE-46; TZ 9-bo‘lim). Ta’riflar BE-28 bilan bir xil (TC2): yaroqli —
 * yaroqsiz, dublikat va tekshiruvdagi (IP) lid emas; har son o‘z hodisa kunida; operator kesimi — BE-28 operator
 * statistikasi qoidalari (urinishlar, ishlagan yaroqli lidlar, tasdiqlaganlari kogortasi, o‘z birinchi qo‘ng‘irog‘i).
 */
@Injectable()
export class PlatformStatsService {
  constructor(
    private readonly db: DataSource,
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
  ) {}

  async platform(input: {
    from: string;
    to: string;
    groupBy?: PlatformMetricsGroupBy;
  }): Promise<PlatformLeadMetricsDto> {
    const from = validDay(input?.from, 'from');
    const to = validDay(input?.to, 'to');
    if (from > to) throw new BadRequestException('from to dan katta');
    if (
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000 >=
      MAX_DAYS
    )
      throw new BadRequestException('Davr bir yildan oshmasin');
    const groupBy = input?.groupBy ?? PlatformMetricsGroupBy.DAY;
    if (!Object.values(PlatformMetricsGroupBy).includes(groupBy))
      throw new BadRequestException('groupBy noto‘g‘ri');
    const range = [tashkentDayStart(from), tashkentDayStart(to, 1)];

    const grouped =
      groupBy === PlatformMetricsGroupBy.OPERATOR
        ? await this.operators(range, true)
        : await this.funnel(range, groupBy, true);
    const totals =
      groupBy === PlatformMetricsGroupBy.OPERATOR
        ? await this.operators(range, false)
        : await this.funnel(range, groupBy, false);
    const operator = groupBy === PlatformMetricsGroupBy.OPERATOR;
    const total = totals.get(TOTAL) ?? empty();
    if (!operator) {
      // Sotuvchi daromadi — faqat ledgerdan (BE-28 qoidasi: yetkazilgan kunda +, qaytarilgan kunda −).
      const income = await sendRpc<PlatformAffiliateIncomeResult>(
        this.finance,
        { cmd: PLATFORM_METRICS_RPC.AFFILIATE_INCOME },
        { from, to, groupBy },
      );
      for (const r of income.rows) {
        let counts = grouped.get(r.key);
        if (!counts) grouped.set(r.key, (counts = empty()));
        counts.income = r.amount;
      }
      total.income = income.total;
    }
    // Kun kesimida bo‘sh kunlar ham qator (grafik uchun; moliya qismi bilan bir xil).
    if (groupBy === PlatformMetricsGroupBy.DAY)
      for (
        let t = Date.parse(`${from}T00:00:00Z`);
        t <= Date.parse(`${to}T00:00:00Z`);
        t += 86_400_000
      ) {
        const day = new Date(t).toISOString().slice(0, 10);
        if (!grouped.has(day)) grouped.set(day, empty());
      }
    const rows = [...grouped.entries()]
      .sort(([a], [b]) =>
        groupBy === PlatformMetricsGroupBy.DAY
          ? a.localeCompare(b)
          : Number(a) - Number(b),
      )
      .map(([key, counts]) => this.row(key, counts, operator));
    return {
      rows,
      totals: this.row(TOTAL, total, operator),
    };
  }

  /** Kun, sotuvchi yoki offer kesimi (`perGroup` = false — jami). */
  private async funnel(
    range: Date[],
    groupBy: PlatformMetricsGroupBy,
    perGroup: boolean,
  ): Promise<Map<string, Counts>> {
    const result = new Map<string, Counts>();
    const at = (key: string) => {
      let counts = result.get(key);
      if (!counts) result.set(key, (counts = empty()));
      return counts;
    };
    // kalit: kun — hodisa vaqtidan (Toshkent), sotuvchi va offer — lid yoki sahifadan
    const key = (ts: string, affiliate: string, product: string) =>
      !perGroup
        ? `'${TOTAL}'`
        : groupBy === PlatformMetricsGroupBy.DAY
          ? `to_char((${ts} AT TIME ZONE 'Asia/Tashkent')::date, 'YYYY-MM-DD')`
          : groupBy === PlatformMetricsGroupBy.AFFILIATE
            ? `COALESCE(${affiliate}::text, '')`
            : `COALESCE(${product}::text, '')`;

    for (const row of (await this.db.query(
      `SELECT ${key('c.created_at', 's.affiliate_id', 's.product_id')} AS key, count(*)::int AS n
         FROM lead.click c JOIN lead.stream s ON s.id = c.stream_id
        WHERE c.created_at >= $1 AND c.created_at < $2
        GROUP BY 1`,
      range,
    )) as Array<{ key: string; n: number }>)
      at(row.key).clicks = row.n;

    for (const row of (await this.db.query(
      `SELECT ${key('l.created_at', 'l.affiliate_id', 'l.product_id')} AS key, count(*)::int AS n,
              count(*) FILTER (WHERE l.status = $3)::int AS invalid,
              count(*) FILTER (WHERE l.status = $4)::int AS duplicates,
              count(*) FILTER (WHERE l.status <> ALL($5::text[]) AND l.review_reason IS NULL)::int AS valid,
              count(*) FILTER (WHERE l.status = $6 AND l.review_reason IS NULL)::int AS no_contact
         FROM lead.lead l
        WHERE l.is_deleted = false AND l.created_at >= $1 AND l.created_at < $2
        GROUP BY 1`,
      [
        ...range,
        LeadStatus.INVALID,
        LeadStatus.MERGED,
        NOT_VALID,
        LeadStatus.NO_CONTACT,
      ],
    )) as Array<{
      key: string;
      n: number;
      invalid: number;
      duplicates: number;
      valid: number;
      no_contact: number;
    }>) {
      const counts = at(row.key);
      counts.leads = row.n;
      counts.invalid = row.invalid;
      counts.duplicates = row.duplicates;
      counts.validLeads = row.valid;
      counts.noContact = row.no_contact;
    }

    for (const ts of ['confirmed_at', 'delivered_at', 'refused_at'] as const)
      for (const row of (await this.db.query(
        `SELECT ${key(`l.${ts}`, 'l.affiliate_id', 'l.product_id')} AS key, count(*)::int AS n,
                COALESCE(sum(l.sale_price * l.quantity), 0)::text AS goods
           FROM lead.lead l
          WHERE l.is_deleted = false AND l.${ts} >= $1 AND l.${ts} < $2
          GROUP BY 1`,
        range,
      )) as Array<{ key: string; n: number; goods: string }>) {
        const counts = at(row.key);
        if (ts === 'confirmed_at') counts.confirmed = row.n;
        if (ts === 'refused_at') counts.refused = row.n;
        if (ts === 'delivered_at') {
          counts.delivered = row.n;
          counts.goodsTotal = Number(row.goods);
        }
      }

    // birinchi qo‘ng‘iroq: davrda kelgan lid → birinchi urinishgacha (kim bo‘lishidan qat’i nazar), median
    for (const row of (await this.db.query(
      `SELECT ${key('l.created_at', 'l.affiliate_id', 'l.product_id')} AS key,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY extract(epoch FROM f.first_at - l.created_at) / 60) AS median
         FROM lead.lead l
         JOIN (SELECT lead_id, min(created_at) AS first_at FROM lead.lead_attempt GROUP BY lead_id) f
           ON f.lead_id = l.id
        WHERE l.is_deleted = false AND l.created_at >= $1 AND l.created_at < $2
        GROUP BY 1`,
      range,
    )) as Array<{ key: string; median: string | number | null }>)
      at(row.key).firstCall =
        row.median === null ? null : Math.round(Number(row.median));

    return result;
  }

  /** Operator kesimi — BE-28 `operatorStats` qoidalari (TC2), operator bo‘yicha guruhlab. */
  private async operators(
    range: Date[],
    perGroup: boolean,
  ): Promise<Map<string, Counts>> {
    const result = new Map<string, Counts>();
    const at = (key: string) => {
      let counts = result.get(key);
      if (!counts) result.set(key, (counts = empty()));
      return counts;
    };
    const key = (column: string) =>
      perGroup ? `${column}::text` : `'${TOTAL}'`;
    for (const row of (await this.db.query(
      `SELECT ${key('a.operator_id')} AS key, count(*)::int AS attempts,
              count(DISTINCT a.lead_id) FILTER (WHERE l.status <> ALL($3::text[]))::int AS worked
         FROM lead.lead_attempt a JOIN lead.lead l ON l.id = a.lead_id
        WHERE a.created_at >= $1 AND a.created_at < $2 AND a.operator_id IS NOT NULL
        GROUP BY 1`,
      [...range, NOT_VALID],
    )) as Array<{ key: string; attempts: number; worked: number }>) {
      at(row.key).attempts = row.attempts;
      at(row.key).worked = row.worked;
    }
    for (const row of (await this.db.query(
      `SELECT ${key('confirmed_by')} AS key, count(*)::int AS confirmed,
              count(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered,
              count(*) FILTER (WHERE refused_at IS NOT NULL AND delivered_at IS NULL)::int AS refused
         FROM lead.lead
        WHERE confirmed_by IS NOT NULL AND confirmed_at >= $1 AND confirmed_at < $2 AND is_deleted = false
        GROUP BY 1`,
      range,
    )) as Array<{
      key: string;
      confirmed: number;
      delivered: number;
      refused: number;
    }>) {
      const counts = at(row.key);
      counts.confirmed = row.confirmed;
      counts.delivered = row.delivered;
      counts.refused = row.refused;
    }
    for (const row of (await this.db.query(
      `SELECT ${key('a.operator_id')} AS key,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY extract(epoch FROM a.created_at - l.created_at) / 60) AS median
         FROM lead.lead_attempt a JOIN lead.lead l ON l.id = a.lead_id
        WHERE a.created_at >= $1 AND a.created_at < $2 AND a.operator_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM lead.lead_attempt b
             WHERE b.lead_id = a.lead_id
               AND (b.created_at < a.created_at OR (b.created_at = a.created_at AND b.id < a.id)))
        GROUP BY 1`,
      range,
    )) as Array<{ key: string; median: string | number | null }>)
      at(row.key).firstCall =
        row.median === null ? null : Math.round(Number(row.median));
    return result;
  }

  private row(
    key: string,
    c: Counts,
    operator: boolean,
  ): PlatformLeadMetricsRowDto {
    return {
      key,
      clicks: operator ? null : c.clicks,
      leads: operator ? null : c.leads,
      invalid: operator ? null : c.invalid,
      duplicates: operator ? null : c.duplicates,
      validLeads: operator ? null : c.validLeads,
      noContact: operator ? null : c.noContact,
      attempts: operator ? c.attempts : null,
      confirmed: c.confirmed,
      delivered: c.delivered,
      refused: c.refused,
      // (barcha − yaroqsiz − dublikat − tekshiruvdagi) / barcha — BE-28 «yaroqli» bilan bir xil (TZ 01:489)
      validLeadRate: operator ? null : percent(c.validLeads, c.leads),
      approveRate: operator
        ? percent(c.confirmed, c.worked)
        : percent(c.confirmed, c.validLeads),
      saleRate: percent(c.delivered, c.delivered + c.refused),
      lostLeadRate: operator ? null : percent(c.noContact, c.validLeads),
      firstCallMedianMinutes: c.firstCall,
      averageCheck:
        operator || !c.delivered
          ? null
          : Math.round(c.goodsTotal / c.delivered),
      affiliateIncome: operator ? null : c.income,
      epc: operator || !c.clicks ? null : Math.round(c.income / c.clicks),
    };
  }
}
