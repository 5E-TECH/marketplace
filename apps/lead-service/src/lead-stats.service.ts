import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import {
  AffiliateCommissionState,
  AffiliateLeadRowDto,
  AffiliateLeadsPageDto,
  AffiliateLeadsQueryDto,
  AffiliateStatsDto,
  AffiliateStatsGroupBy,
  AffiliateStatsQueryDto,
  AffiliateStatsRowDto,
  FINANCE_AFFILIATE_RPC,
  FinanceAffiliateIncomeLine,
  FinanceAffiliateIncomeQuery,
  FinanceAffiliateIncomeResult,
  LeadOrderStatus,
  LeadStatsPeriodQueryDto,
  LeadStatus,
  OperatorStatsDto,
  RmqClient,
  sendRpc,
} from '@app/common';
import { DELIVERED_LIKE } from './lead-order.service';
import { tashkentDayStart, tashkentParts } from './lead-schedule';
import { percent } from './offer-math';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,19}$/;
const DEFAULT_LIMIT = 20;
/** AffiliatePageQueryDto: limit ≤ 100 (BE-25 shartnomasi). */
const MAX_LIMIT = 100;
/** Yaroqsiz va dublikat — «yaroqli» ga kirmaydi (TZ 01:489; offer.service NOT_VALID). */
const NOT_VALID = [LeadStatus.INVALID, LeadStatus.MERGED];
/** Lid holati bo‘yicha haq yozilmaydi (hujjat-statistika-csv I: «Yozilmaydi»). */
const NO_COMMISSION_LEAD = new Set<LeadStatus>([
  LeadStatus.REJECTED,
  LeadStatus.INVALID,
  LeadStatus.MERGED,
  LeadStatus.NO_CONTACT,
]);
/** Buyurtma yetkazilmay tugadi — haq yozilmaydi. */
const NO_COMMISSION_ORDER = new Set<string>([
  LeadOrderStatus.REFUSED,
  LeadOrderStatus.RETURNING,
  LeadOrderStatus.RETURNED_GRADED,
  LeadOrderStatus.CANCELLED,
]);
export const STATS_TOTAL_KEY = 'TOTAL';

interface Period {
  from: string;
  to: string;
  start: Date;
  end: Date;
}

export function validDay(value: unknown, field: string): string {
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

/** Toshkent kunlari, `to` kuni ham kiradi (BE-42 bilan bir xil). */
function period(query: { from?: unknown; to?: unknown } | undefined): Period {
  const from = validDay(query?.from, 'from');
  const to = validDay(query?.to, 'to');
  if (from > to) throw new BadRequestException('from to dan katta');
  return {
    from,
    to,
    start: tashkentDayStart(from),
    end: tashkentDayStart(to, 1),
  };
}

function validId(value: unknown, field: string): string {
  const s = String(value ?? '');
  if (!ID.test(s)) throw new BadRequestException(`${field} noto‘g‘ri`);
  return s;
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= to;
    d = new Date(d.getTime() + 86_400_000)
  )
    out.push(d.toISOString().slice(0, 10));
  return out;
}

const emptyRow = (key: string): AffiliateStatsRowDto => ({
  key,
  clicks: 0,
  leads: 0,
  validLeads: 0,
  confirmed: 0,
  delivered: 0,
  refused: 0,
  incomeHold: 0,
  incomeAvailable: 0,
});

/**
 * Statistika serverda (BE-28; SOT-4, OPR-7). Har son o‘z hodisa kunida (dizayn «sotuvchi-statistika»):
 * klik — klik kuni, lid va yaroqli — lid kelgan kun, tasdiq — tasdiq kuni, yetkazildi va rad — buyurtma
 * hodisasi kuni, daromad — ledger yozuvi kuni (yetkazilgan kun; qaytarilgan kunda minus). Pul faqat
 * ledgerdan (BE-22, `finance.affiliate.income`). Variant, manzil, ism va to‘liq telefon sotuvchiga qaytmaydi.
 */
@Injectable()
export class LeadStatsService {
  constructor(
    private readonly db: DataSource,
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
  ) {}

  /** Bugungi Toshkent sanasi `YYYY-MM-DD` (testda almashtiriladi). */
  protected todayTashkent(): string {
    const t = tashkentParts(new Date());
    return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
  }

  private income(
    query: FinanceAffiliateIncomeQuery,
  ): Promise<FinanceAffiliateIncomeResult> {
    return sendRpc(this.finance, { cmd: FINANCE_AFFILIATE_RPC.INCOME }, query);
  }

  /** GET /affiliate/stats — kun, sotuvchi sahifasi yoki sub1 bo‘yicha (SOT-4). */
  async affiliateStats(input: {
    affiliateId: string;
    query: AffiliateStatsQueryDto;
  }): Promise<AffiliateStatsDto> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    const p = period(input?.query);
    const groupBy = input.query.groupBy ?? AffiliateStatsGroupBy.DAY;
    if (!Object.values(AffiliateStatsGroupBy).includes(groupBy))
      throw new BadRequestException('groupBy noto‘g‘ri');
    const streamId = input.query.streamId
      ? validId(input.query.streamId, 'streamId')
      : null;

    const key = (alias: string, ts: string) =>
      groupBy === AffiliateStatsGroupBy.DAY
        ? `to_char((${alias}.${ts} AT TIME ZONE 'Asia/Tashkent')::date, 'YYYY-MM-DD')`
        : groupBy === AffiliateStatsGroupBy.STREAM
          ? `COALESCE(s.code, '')`
          : `COALESCE(${alias}.sub1, '')`;
    const params = [affiliateId, p.start, p.end, streamId];
    const rows = new Map<string, AffiliateStatsRowDto>();
    const row = (k: string) => {
      let r = rows.get(k);
      if (!r) rows.set(k, (r = emptyRow(k)));
      return r;
    };
    if (groupBy === AffiliateStatsGroupBy.DAY) {
      // Bo‘sh kunlar faqat sotuvchi birinchi sahifasini ochgan kundan bugungacha (kelajak kunlari yopiq — dizayn
      // «sotuvchi-statistika» kalendari): javob hajmi so‘rovdagi davrga emas, sotuvchining haqiqiy muddatiga bog‘liq.
      const [{ first }] = (await this.db.query(
        `SELECT to_char((min(created_at) AT TIME ZONE 'Asia/Tashkent')::date, 'YYYY-MM-DD') AS first
           FROM lead.stream WHERE affiliate_id = $1`,
        [affiliateId],
      )) as Array<{ first: string | null }>;
      const today = this.todayTashkent();
      const lo = first && first > p.from ? first : p.from;
      const hi = today < p.to ? today : p.to;
      if (first && lo <= hi) for (const d of daysBetween(lo, hi)) row(d);
    }

    const clicks = (await this.db.query(
      `SELECT ${key('c', 'created_at')} AS key, count(*)::int AS n
         FROM lead.click c JOIN lead.stream s ON s.id = c.stream_id
        WHERE s.affiliate_id = $1 AND c.created_at >= $2 AND c.created_at < $3
          AND ($4::bigint IS NULL OR c.stream_id = $4)
        GROUP BY 1`,
      params,
    )) as Array<{ key: string; n: number }>;
    for (const c of clicks) row(c.key).clicks = c.n;

    const byLead = async (
      ts: 'created_at' | 'confirmed_at' | 'delivered_at' | 'refused_at',
    ) =>
      (await this.db.query(
        `SELECT ${key('l', ts)} AS key, count(*)::int AS n,
                count(*) FILTER (WHERE l.status <> ALL($5::text[]) AND l.review_reason IS NULL)::int AS valid
           FROM lead.lead l LEFT JOIN lead.stream s ON s.id = l.stream_id
          WHERE l.affiliate_id = $1 AND l.is_deleted = false
            AND l.${ts} >= $2 AND l.${ts} < $3
            AND ($4::bigint IS NULL OR l.stream_id = $4)
          GROUP BY 1`,
        [...params, NOT_VALID],
      )) as Array<{ key: string; n: number; valid: number }>;
    for (const r of await byLead('created_at')) {
      row(r.key).leads = r.n;
      row(r.key).validLeads = r.valid;
    }
    for (const r of await byLead('confirmed_at')) row(r.key).confirmed = r.n;
    for (const r of await byLead('delivered_at')) row(r.key).delivered = r.n;
    for (const r of await byLead('refused_at')) row(r.key).refused = r.n;

    const { lines } = await this.income({
      affiliateId,
      from: p.from,
      to: p.to,
    });
    const leadKeys = await this.incomeKeys(
      affiliateId,
      lines,
      groupBy,
      streamId,
    );
    for (const line of lines) {
      const k =
        groupBy === AffiliateStatsGroupBy.DAY
          ? line.day
          : line.leadId !== null
            ? leadKeys.get(line.leadId)
            : '';
      if (k === undefined) continue; // boshqa sahifa (streamId filtri) yoki boshqa sotuvchining lidi
      if (streamId && (line.leadId === null || !leadKeys.has(line.leadId)))
        continue;
      if (line.column === 'AVAILABLE') row(k).incomeAvailable += line.amount;
      else row(k).incomeHold += line.amount;
    }

    const sorted = [...rows.values()].sort((a, b) =>
      a.key === b.key
        ? 0
        : a.key === ''
          ? 1
          : b.key === ''
            ? -1
            : a.key < b.key
              ? -1
              : 1,
    );
    const totals = emptyRow(STATS_TOTAL_KEY);
    for (const r of sorted)
      for (const f of [
        'clicks',
        'leads',
        'validLeads',
        'confirmed',
        'delivered',
        'refused',
        'incomeHold',
        'incomeAvailable',
      ] as const)
        totals[f] += r[f];
    return { rows: sorted, totals };
  }

  /**
   * Daromad qatori qaysi guruhga tushadi (sahifa yoki sub1 — lid jadvalidan). DAY da faqat streamId filtri uchun.
   * Natijada yo‘q lid — bu sotuvchiniki emas yoki boshqa sahifaniki: qator tashlanadi.
   */
  private async incomeKeys(
    affiliateId: string,
    lines: FinanceAffiliateIncomeLine[],
    groupBy: AffiliateStatsGroupBy,
    streamId: string | null,
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        lines
          .map((l) => l.leadId)
          .filter((x): x is string => x !== null && ID.test(x)),
      ),
    ];
    const out = new Map<string, string>();
    if (!ids.length || (groupBy === AffiliateStatsGroupBy.DAY && !streamId))
      return out;
    const rows = (await this.db.query(
      `SELECT l.id::text AS id, COALESCE(s.code, '') AS code, COALESCE(l.sub1, '') AS sub1
         FROM lead.lead l LEFT JOIN lead.stream s ON s.id = l.stream_id
        WHERE l.id = ANY($1::bigint[]) AND l.affiliate_id = $2
          AND ($3::bigint IS NULL OR l.stream_id = $3)`,
      [ids, affiliateId, streamId],
    )) as Array<{ id: string; code: string; sub1: string }>;
    for (const r of rows)
      out.set(
        r.id,
        groupBy === AffiliateStatsGroupBy.STREAM
          ? r.code
          : groupBy === AffiliateStatsGroupBy.SUB1
            ? r.sub1
            : '',
      );
    return out;
  }

  /** GET /affiliate/leads — lidlar va CSV manbasi (hujjat-statistika-csv A–I). Yangilari birinchi. */
  async affiliateLeads(input: {
    affiliateId: string;
    query: AffiliateLeadsQueryDto;
  }): Promise<AffiliateLeadsPageDto> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    const p = period(input?.query);
    const q = input.query;
    const streamId = q.streamId ? validId(q.streamId, 'streamId') : null;
    if (q.status !== undefined && !Object.values(LeadStatus).includes(q.status))
      throw new BadRequestException('status noto‘g‘ri');
    const page = Math.max(1, Math.trunc(Number(q.page)) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.trunc(Number(q.limit)) || DEFAULT_LIMIT),
    );
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset))
      throw new BadRequestException('page juda katta');
    const where = `l.affiliate_id = $1 AND l.is_deleted = false
       AND l.created_at >= $2 AND l.created_at < $3
       AND ($4::bigint IS NULL OR l.stream_id = $4)
       AND ($5::text IS NULL OR l.status = $5)`;
    const params = [affiliateId, p.start, p.end, streamId, q.status ?? null];
    const [{ total }] = (await this.db.query(
      `SELECT count(*)::int AS total FROM lead.lead l WHERE ${where}`,
      params,
    )) as Array<{ total: number }>;
    const rows = (await this.db.query(
      `SELECT l.id::text AS id, l.created_at AS "createdAt", COALESCE(s.code, '') AS "streamCode",
              l.sub1, l.sub2, l.sub3, l.sub4, l.sub5, l.phone_e164 AS phone, l.status,
              l.order_status AS "orderStatus", l.expected_commission::text AS expected,
              l.review_reason AS "reviewReason"
         FROM lead.lead l LEFT JOIN lead.stream s ON s.id = l.stream_id
        WHERE ${where}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT $6 OFFSET $7`,
      [...params, limit, offset],
    )) as Array<{
      id: string;
      createdAt: Date;
      streamCode: string;
      sub1: string | null;
      sub2: string | null;
      sub3: string | null;
      sub4: string | null;
      sub5: string | null;
      phone: string;
      status: LeadStatus;
      orderStatus: string | null;
      expected: string | null;
      reviewReason: string | null;
    }>;

    const confirmedIds = rows
      .filter((r) => r.status === LeadStatus.CONFIRMED)
      .map((r) => r.id);
    const ledger = new Map<string, { amount: number; state: string }>();
    if (confirmedIds.length) {
      const { lines } = await this.income({
        affiliateId,
        leadIds: confirmedIds,
      });
      for (const l of lines) {
        if (l.leadId === null) continue;
        const prev = ledger.get(l.leadId);
        ledger.set(l.leadId, {
          amount: (prev?.amount ?? 0) + l.amount,
          state: l.state,
        });
      }
    }

    const items = rows.map((r): AffiliateLeadRowDto => {
      const { commission, commissionState } = commissionOf(
        r.status,
        r.orderStatus,
        r.expected,
        ledger.get(r.id),
      );
      return {
        id: r.id,
        createdAt: r.createdAt,
        streamCode: r.streamCode,
        sub1: r.sub1,
        sub2: r.sub2,
        sub3: r.sub3,
        sub4: r.sub4,
        sub5: r.sub5,
        // Tekshiruvdagi ariza: mijoz yashirin (LID-5 [taklif]); qolganida faqat oxirgi 4 raqam (SOT-4).
        phoneLast4: r.reviewReason ? '****' : `****${r.phone.slice(-4)}`,
        status: r.status,
        orderStatus: r.orderStatus,
        commission,
        commissionState,
      };
    });
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * GET /operator/stats — operatorning o‘z statistikasi (OPR-7). Bazadan to‘g‘ridan-to‘g‘ri, kesh yo‘q:
   * natija saqlanishi bilan yangilanadi (TC3 «bir daqiqada»).
   * - urinishlar: shu davrdagi natijalar (javobsiz ham);
   * - tasdiq %: tasdiqlagan lidlari / shu davrda ishlagan yaroqli lidlari;
   * - sotilish %: shu davrda tasdiqlaganlaridan yetkazilgan / (yetkazilgan + rad);
   * - birinchi qo‘ng‘iroq: lid kelganidan birinchi urinishgacha (shu operatorniki bo‘lsa), median, daqiqa.
   */
  async operatorStats(input: {
    operatorId: string;
    query: LeadStatsPeriodQueryDto;
  }): Promise<OperatorStatsDto> {
    const operatorId = validId(input?.operatorId, 'operatorId');
    const p = period(input?.query);
    const range = [operatorId, p.start, p.end];
    const [{ attempts, worked }] = (await this.db.query(
      `SELECT count(*)::int AS attempts,
              count(DISTINCT a.lead_id) FILTER (WHERE l.status <> ALL($4::text[]))::int AS worked
         FROM lead.lead_attempt a JOIN lead.lead l ON l.id = a.lead_id
        WHERE a.operator_id = $1 AND a.created_at >= $2 AND a.created_at < $3`,
      [...range, NOT_VALID],
    )) as Array<{ attempts: number; worked: number }>;
    const [{ confirmed, delivered, refused }] = (await this.db.query(
      `SELECT count(*)::int AS confirmed,
              count(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered,
              count(*) FILTER (WHERE refused_at IS NOT NULL AND delivered_at IS NULL)::int AS refused
         FROM lead.lead
        WHERE confirmed_by = $1 AND confirmed_at >= $2 AND confirmed_at < $3 AND is_deleted = false`,
      range,
    )) as Array<{ confirmed: number; delivered: number; refused: number }>;
    const [{ median }] = (await this.db.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (
                ORDER BY extract(epoch FROM a.created_at - l.created_at) / 60) AS median
         FROM lead.lead_attempt a JOIN lead.lead l ON l.id = a.lead_id
        WHERE a.operator_id = $1 AND a.created_at >= $2 AND a.created_at < $3
          AND NOT EXISTS (
            SELECT 1 FROM lead.lead_attempt b
             WHERE b.lead_id = a.lead_id
               AND (b.created_at < a.created_at OR (b.created_at = a.created_at AND b.id < a.id)))`,
      range,
    )) as Array<{ median: string | number | null }>;
    return {
      attempts,
      confirmed,
      approveRate: percent(confirmed, worked),
      saleRate: percent(delivered, delivered + refused),
      firstCallMedianMinutes:
        median === null ? null : Math.round(Number(median)),
    };
  }
}

/** Haq va haq holati (hujjat-statistika-csv H, I). Ledger yozuvi bo‘lsa — u asosiy manba. */
export function commissionOf(
  status: LeadStatus,
  orderStatus: string | null,
  expected: string | null,
  ledger: { amount: number; state: string } | undefined,
): Pick<AffiliateLeadRowDto, 'commission' | 'commissionState'> {
  if (ledger)
    return {
      commission: ledger.amount,
      commissionState: ledger.state as AffiliateCommissionState,
    };
  if (NO_COMMISSION_LEAD.has(status))
    return { commission: null, commissionState: AffiliateCommissionState.NONE };
  if (status !== LeadStatus.CONFIRMED)
    return { commission: null, commissionState: null }; // hali ishlanmoqda
  if (orderStatus && NO_COMMISSION_ORDER.has(orderStatus))
    return { commission: null, commissionState: AffiliateCommissionState.NONE };
  // Yetkazilgan, lekin sotuvchi qatori ledgerda yo‘q: haq 0 bo‘lsa ledger qator yozmaydi (split.ts) — «Yozilmaydi».
  // Haq musbat bo‘lsa — ledger hali yozmagan (hodisa yo‘lda) yoki finance xatosi: «Kutilmoqda» qoladi.
  if (
    orderStatus &&
    DELIVERED_LIKE.has(orderStatus as LeadOrderStatus) &&
    (expected === null || Number(expected) === 0)
  )
    return { commission: null, commissionState: AffiliateCommissionState.NONE };
  return {
    commission: expected === null ? null : Number(expected),
    commissionState: AffiliateCommissionState.PENDING,
  };
}
