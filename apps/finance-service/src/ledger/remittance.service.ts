import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  moneyFromDb,
  RemittanceDayDto,
  RemittanceItemDto,
  RemittanceItemPageDto,
  RemittanceItemsQueryDto,
  RemittanceViewState,
} from '@app/common';

const ID = /^\d{1,19}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const MAX_DAYS = 366;
const TASHKENT_DATE = (col: string) =>
  `(${col} AT TIME ZONE 'Asia/Tashkent')::date`;

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

export function validRange(from: unknown, to: unknown): [string, string] {
  const f = validDay(from, 'from');
  const t = validDay(to, 'to');
  if (f > t) throw new BadRequestException('from > to');
  if (
    (Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000 +
      1 >
    MAX_DAYS
  )
    throw new BadRequestException(`Davr ${MAX_DAYS} kundan oshmasin`);
  return [f, t];
}

/**
 * Buyurtma bo‘yicha oxirgi o‘tkazma qatori. BE-22 farqni buyurtma bo‘yicha hisoblab, buyurtmaning hamma qatorlariga
 * bir xil yozadi — shuning uchun qatorlar yig‘ilmaydi, buyurtmaning oxirgisi olinadi (`perDay` — kun ichida oxirgisi).
 * - kind: yetkazilgan jurnali bo‘lsa DELIVERED, faqat rad jurnali bo‘lsa REFUSED (BE-22 `applyRemittance` tartibi);
 * - view_diff: Elchi − tizim o‘tkazma ma’nosida (DZ-07): yetkazilganda kelgan − kutilgan, radda kutilgan − ushlangan;
 * - state: PARTIAL/MISMATCH — hal qilinmagan bo‘lsa DIFF, aks holda RESOLVED; MATCHED; qolgani PENDING.
 * `$1`, `$2` — Toshkent kunlari (kiradi); `null` — chegara yo‘q.
 */
export function latestRemittanceSql(perDay: boolean): string {
  return `
    SELECT l.*, j.order_number,
           CASE WHEN j.delivered THEN 'DELIVERED' WHEN j.refused THEN 'REFUSED' END AS kind,
           CASE WHEN l.diff IS NULL THEN NULL
                WHEN NOT j.delivered AND j.refused THEN -l.diff ELSE l.diff END AS view_diff,
           CASE WHEN l.match_state IN ('PARTIAL','MISMATCH') AND l.resolved_at IS NULL THEN 'DIFF'
                WHEN l.match_state IN ('PARTIAL','MISMATCH') THEN 'RESOLVED'
                WHEN l.match_state = 'MATCHED' THEN 'MATCHED' ELSE 'PENDING' END AS view_state
      FROM (
        SELECT DISTINCT ON (ri.order_id${perDay ? `, ${TASHKENT_DATE('ri.created_at')}` : ''})
               ri.*, ${TASHKENT_DATE('ri.created_at')} AS day
          FROM finance.remittance_item ri
         WHERE ($1::date IS NULL OR ri.created_at >= ($1::date)::timestamp AT TIME ZONE 'Asia/Tashkent')
           AND ($2::date IS NULL OR ri.created_at < ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Tashkent')
         ORDER BY ri.order_id${perDay ? `, ${TASHKENT_DATE('ri.created_at')}` : ''}, ri.id DESC
      ) l
      LEFT JOIN LATERAL (
        SELECT MAX(order_number) AS order_number,
               COALESCE(bool_or(kind = 'ORDER_DELIVERED'), false) AS delivered,
               COALESCE(bool_or(kind = 'ORDER_REFUSED'), false) AS refused
          FROM finance.journal WHERE order_id = l.order_id
      ) j ON true`;
}

type ItemRow = {
  id: string;
  order_id: string;
  order_number: string | null;
  shipment_id: string | null;
  elchi_status: string;
  kind: 'DELIVERED' | 'REFUSED' | null;
  collected_from_customer: string | null;
  elchi_fee: string | null;
  market_paid_amount: string | null;
  refusal_fee: string | null;
  expected_amount: string | null;
  view_diff: string | null;
  match_state: string;
  view_state: RemittanceViewState;
  created_at: Date;
  resolution_comment: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
};

const money = (v: string | null) => (v === null ? null : moneyFromDb(v));

function toItem(r: ItemRow): RemittanceItemDto {
  return {
    id: String(r.id),
    orderId: r.order_id,
    orderNumber: r.order_number,
    shipmentId: r.shipment_id,
    elchiStatus: r.elchi_status,
    kind: r.kind,
    collectedFromCustomer: money(r.collected_from_customer),
    elchiFee: money(r.elchi_fee),
    marketPaidAmount: money(r.market_paid_amount),
    refusalFee: money(r.refusal_fee),
    expectedAmount: money(r.expected_amount),
    diff: money(r.view_diff),
    matchState: r.match_state,
    state: r.view_state,
    receivedAt: r.created_at,
    resolution: r.resolved_at
      ? {
          comment: r.resolution_comment ?? '',
          by: r.resolved_by ?? '',
          at: r.resolved_at,
        }
      : null,
  };
}

/** BE-46 (FE-19): Elchi sverkasi — kunlar, posilkalar, farqni izoh bilan yopish. */
@Injectable()
export class RemittanceService {
  constructor(private readonly dataSource: DataSource) {}

  /** Kunlar ro‘yxati (DZ-07 chap ustun): holat va kun jami; faqat o‘tkazma kelgan kunlar, yangisi birinchi. */
  async days(input: {
    from?: string;
    to?: string;
  }): Promise<RemittanceDayDto[]> {
    const [from, to] = validRange(input?.from, input?.to);
    const rows = (await this.dataSource.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, COUNT(*)::int AS orders,
              COUNT(*) FILTER (WHERE view_state = 'DIFF')::int AS "diffCount",
              COUNT(*) FILTER (WHERE view_state = 'RESOLVED')::int AS "resolvedCount",
              COUNT(*) FILTER (WHERE view_state = 'MATCHED')::int AS "matchedCount",
              COUNT(*) FILTER (WHERE view_state = 'PENDING')::int AS "pendingCount",
              COALESCE(SUM(collected_from_customer), 0)::text AS collected,
              COALESCE(SUM(elchi_fee), 0)::text AS "elchiFee",
              COALESCE(SUM(refusal_fee), 0)::text AS "refusalFee",
              COALESCE(SUM(CASE WHEN kind = 'REFUSED' THEN -COALESCE(refusal_fee, 0)
                                ELSE COALESCE(market_paid_amount, 0) END), 0)::text AS "elchiTotal",
              COALESCE(SUM(CASE WHEN kind = 'REFUSED' THEN -COALESCE(expected_amount, 0)
                                ELSE COALESCE(expected_amount, 0) END), 0)::text AS "systemTotal",
              COALESCE(SUM(view_diff) FILTER (WHERE view_state = 'DIFF'), 0)::text AS "openDiff"
         FROM (${latestRemittanceSql(true)}) v
        GROUP BY day ORDER BY day DESC`,
      [from, to],
    )) as Array<Record<string, string | number>>;
    return rows.map((r) => {
      const n = (k: string) => Number(r[k]);
      const state = n('diffCount')
        ? RemittanceViewState.DIFF
        : n('pendingCount')
          ? RemittanceViewState.PENDING
          : n('resolvedCount')
            ? RemittanceViewState.RESOLVED
            : RemittanceViewState.MATCHED;
      return {
        day: String(r.day),
        state,
        orders: n('orders'),
        diffCount: n('diffCount'),
        resolvedCount: n('resolvedCount'),
        matchedCount: n('matchedCount'),
        pendingCount: n('pendingCount'),
        collected: moneyFromDb(String(r.collected)),
        elchiFee: moneyFromDb(String(r.elchiFee)),
        refusalFee: moneyFromDb(String(r.refusalFee)),
        elchiTotal: moneyFromDb(String(r.elchiTotal)),
        systemTotal: moneyFromDb(String(r.systemTotal)),
        openDiff: moneyFromDb(String(r.openDiff)),
      };
    });
  }

  /** Posilkalar (DZ-07 jadvali): kun (bo‘lmasa — hammasi), holat tabi, buyurtma ID si yoki raqami bo‘yicha. */
  async items(input: {
    query?: RemittanceItemsQueryDto;
  }): Promise<RemittanceItemPageDto> {
    const q = input?.query ?? {};
    const day = q.day === undefined ? null : validDay(q.day, 'day');
    if (
      q.state !== undefined &&
      !Object.values(RemittanceViewState).includes(q.state)
    )
      throw new BadRequestException('state noto‘g‘ri');
    const search =
      q.search === undefined || q.search === null
        ? null
        : String(q.search).trim().slice(0, 64) || null;
    const page = Math.max(1, Math.trunc(Number(q.page)) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.trunc(Number(q.limit)) || DEFAULT_LIMIT),
    );
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset))
      throw new BadRequestException('page juda katta');
    const where = `($3::text IS NULL OR view_state = $3)
       AND ($4::text IS NULL OR order_id = $4 OR order_number = $4)`;
    const params = [day, day, q.state ?? null, search];
    const [{ total }] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM (${latestRemittanceSql(false)}) v WHERE ${where}`,
      params,
    )) as Array<{ total: number }>;
    // Farq bor qatorlar birinchi (DZ-07: qizil qator yuqorida), keyin yangisi.
    const rows = (await this.dataSource.query(
      `SELECT * FROM (${latestRemittanceSql(false)}) v WHERE ${where}
        ORDER BY (view_state = 'DIFF') DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    )) as ItemRow[];
    return {
      items: rows.map(toItem),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Farqni izoh bilan yopish (FE-19 TC2). Pul harakati yo‘q — yozuvlar HOLD da qoladi [taklif, BE-46 savol 2].
   * Buyurtmaning hamma ochiq farqli qatorlari yopiladi (farq buyurtma bo‘yicha). Keyin yangi o‘tkazma kelsa,
   * uning qatori yana ochiq farq bo‘lib chiqadi.
   */
  async resolve(input: {
    id?: string;
    comment?: string;
    userId?: string;
  }): Promise<RemittanceItemDto> {
    const id = String(input?.id ?? '');
    if (!ID.test(id)) throw new BadRequestException('id noto‘g‘ri');
    const comment = String(input?.comment ?? '').trim();
    if (comment.length < 3 || comment.length > 1000)
      throw new BadRequestException('Izoh majburiy (3–1000 belgi)');
    const userId = String(input?.userId ?? '');
    if (!ID.test(userId)) throw new BadRequestException('userId noto‘g‘ri');

    const orderId = await this.dataSource.transaction(async (m) => {
      const [item] = (await m.query(
        `SELECT order_id AS "orderId", match_state AS match, resolved_at AS "resolvedAt"
           FROM finance.remittance_item WHERE id = $1`,
        [id],
      )) as Array<{ orderId: string; match: string; resolvedAt: Date | null }>;
      if (!item) throw new NotFoundException('O‘tkazma qatori topilmadi');
      // Buyurtmaning qatorlari qulflanadi: BE-22 `applyRemittance` ham ularni buyurtma bo‘yicha yangilaydi.
      const locked = (await m.query(
        `SELECT id::text, match_state AS match, resolved_at AS "resolvedAt"
           FROM finance.remittance_item WHERE order_id = $1 ORDER BY id FOR UPDATE`,
        [item.orderId],
      )) as Array<{ id: string; match: string; resolvedAt: Date | null }>;
      const self = locked.find((r) => r.id === id)!;
      if (!['PARTIAL', 'MISMATCH'].includes(self.match))
        throw new ConflictException('Bu qatorda farq yo‘q');
      if (self.resolvedAt)
        throw new ConflictException('Farq allaqachon hal qilingan');
      await m.query(
        `UPDATE finance.remittance_item
            SET resolution_comment = $2, resolved_by = $3, resolved_at = now(), updated_at = now()
          WHERE order_id = $1 AND match_state IN ('PARTIAL','MISMATCH') AND resolved_at IS NULL`,
        [item.orderId, comment, userId],
      );
      return item.orderId;
    });
    const [row] = (await this.dataSource.query(
      `SELECT * FROM (${latestRemittanceSql(false)}) v WHERE order_id = $3`,
      [null, null, orderId],
    )) as ItemRow[];
    return toItem(row);
  }
}
