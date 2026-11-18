import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CatalogOfferSnapshot,
  isLeadBigintId,
  LeadOrderStatus,
  LeadVariant,
  VariantReportDto,
  VariantReportQueryDto,
  VariantReportRowDto,
} from '@app/common';
import { CatalogOfferClient } from './catalog-offer.client';
import { tashkentDayStart } from './lead-schedule';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Elchi’ga topshirilgan yoki keyingi holat (bekor qilingan kirmaydi). */
const SHIPPED: LeadOrderStatus[] = [
  LeadOrderStatus.HANDED_TO_ELCHI,
  LeadOrderStatus.IN_TRANSIT,
  LeadOrderStatus.DELIVERED,
  LeadOrderStatus.REMITTED,
  LeadOrderStatus.RETURN_REQUESTED,
  LeadOrderStatus.SETTLED,
  LeadOrderStatus.REFUSED,
  LeadOrderStatus.RETURNING,
  LeadOrderStatus.RETURNED_GRADED,
];
/** Qabul qilingandan keyin qaytarilgan (qaytarish so‘rovi hali qaytarish emas) [taklif]. */
const RETURNED: LeadOrderStatus[] = [
  LeadOrderStatus.RETURNING,
  LeadOrderStatus.RETURNED_GRADED,
];
/** Har variantda qabul qilingan posilka maqsadi: ega qarori 2026-11-18 (sinov-s1-s3.md «Qancha kerak», ≈22% farq). */
export const VARIANT_TARGET_ACCEPTED = 400;
export const VARIANT_REPORT_NOTE =
  'Sinov oldindan belgilangan posilka soniga yetguncha natijaga qarab to‘xtatilmaydi: erta qarash noto‘g‘ri g‘olib beradi (sinov-s1-s3.md «Qaror qoidasi»)';

/** YYYY-MM-DD va mavjud sana (2027-02-31 rad etiladi — aks holda davr jim kengayardi). */
const realDay = (s: string) =>
  DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * CSV katagi: formula sifatida ochilmasin (= + - @ tab CR bilan boshlansa «'»), «;», qo‘shtirnoq va qator
 * ko‘chishi bo‘lsa qo‘shtirnoqda. Mahsulot nomini sotuvchi yozadi.
 */
export const csvCell = (value: string): string => {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

type Counts = Omit<
  VariantReportRowDto,
  | 'variant'
  | 'productId'
  | 'productName'
  | 'duplicateRate'
  | 'amountPer1000Visits'
  | 'targetReached'
>;

const empty = (): Counts => ({
  visits: 0,
  applications: 0,
  duplicates: 0,
  valid: 0,
  confirmed: 0,
  shipped: 0,
  accepted: 0,
  returned: 0,
  amount: 0,
  rejectReasons: {},
});

/**
 * BE-39: S1 va S3 sinovi hisoboti (LID-8; `docs/dizayn/storefront-yonalishlar/sinov-s1-s3.md`).
 * - Kogorta: davrdagi tashriflar (klik) va arizalar; ularning keyingi natijasi (tasdiq, jo‘natish, qabul) qachon
 *   bo‘lganidan qat’i nazar hisobga olinadi.
 * - Variant — ariza yozilgan variant; dublikat ariza birinchi arizaning (asosiy lidning) variantida (9-qoida).
 *   Variantsiz lidlar (sotuvchi API si, sayt) kirmaydi.
 * - Yaroqli, tasdiq, jo‘natilgan, qabul — asosiy lidlar bo‘yicha; yaroqli ta’rifi BE-28 bilan bir xil.
 * - Summa — qabul qilingan va qaytarilmagan posilkalar: lid narxi × miqdor (mijoz to‘lagan tovar puli, yetkazishsiz) [taklif].
 */
@Injectable()
export class VariantReportService {
  constructor(
    private readonly db: DataSource,
    private readonly catalog: CatalogOfferClient,
  ) {}

  async report(
    query: VariantReportQueryDto,
    now = new Date(),
  ): Promise<VariantReportDto> {
    const from = String(query?.from ?? '');
    const to = String(query?.to ?? '');
    if (!realDay(from) || !realDay(to) || from > to)
      throw new BadRequestException({
        message: ['from va to YYYY-MM-DD, from ≤ to'],
      });
    if (query.productId !== undefined && !isLeadBigintId(query.productId))
      throw new BadRequestException({ message: ['productId noto‘g‘ri'] });
    const params = [
      tashkentDayStart(from),
      tashkentDayStart(to, 1),
      query.productId ?? null,
    ];
    const [visits, leads, rejects] = await Promise.all([
      this.db.query(
        `SELECT c.variant, s.product_id::text AS "productId", count(*)::int AS n
           FROM lead.click c JOIN lead.stream s ON s.id = c.stream_id
          WHERE c.variant IS NOT NULL AND c.created_at >= $1 AND c.created_at < $2
            AND ($3::bigint IS NULL OR s.product_id = $3)
          GROUP BY 1, 2`,
        params,
      ) as Promise<
        Array<{ variant: LeadVariant; productId: string; n: number }>
      >,
      this.db.query(
        `SELECT v.variant, l.product_id::text AS "productId",
                count(*)::int AS applications,
                count(*) FILTER (WHERE l.merged_into_id IS NOT NULL)::int AS duplicates,
                count(*) FILTER (WHERE l.merged_into_id IS NULL AND l.status NOT IN ('INVALID','MERGED')
                                   AND l.review_reason IS NULL)::int AS valid,
                count(*) FILTER (WHERE l.merged_into_id IS NULL AND l.confirmed_at IS NOT NULL)::int AS confirmed,
                count(*) FILTER (WHERE l.merged_into_id IS NULL AND (l.order_status = ANY($4::text[])
                                   OR l.delivered_at IS NOT NULL OR l.refused_at IS NOT NULL))::int AS shipped,
                count(*) FILTER (WHERE l.merged_into_id IS NULL AND l.delivered_at IS NOT NULL)::int AS accepted,
                count(*) FILTER (WHERE l.merged_into_id IS NULL AND l.delivered_at IS NOT NULL
                                   AND l.order_status = ANY($5::text[]))::int AS returned,
                COALESCE(SUM(l.sale_price * l.quantity) FILTER (
                  WHERE l.merged_into_id IS NULL AND l.delivered_at IS NOT NULL
                    AND NOT (l.order_status = ANY($5::text[]))), 0)::bigint::text AS amount
           FROM lead.lead l
           -- Dublikat zanjiri (ariza → operator «Dublikat» → …) oxirgi asosiy lidgacha; variant — o‘shaniki
           CROSS JOIN LATERAL (
             WITH RECURSIVE up AS (
               SELECT l.id AS id, l.merged_into_id AS next, l.variant AS variant, 0 AS depth
               UNION ALL
               SELECT p.id, p.merged_into_id, p.variant, up.depth + 1
                 FROM up JOIN lead.lead p ON p.id = up.next WHERE up.depth < 20
             )
             SELECT variant FROM up WHERE next IS NULL LIMIT 1
           ) v
          WHERE l.is_deleted = false AND l.created_at >= $1 AND l.created_at < $2
            AND v.variant IS NOT NULL AND ($3::bigint IS NULL OR l.product_id = $3)
          GROUP BY 1, 2`,
        [...params, SHIPPED, RETURNED],
      ) as Promise<
        Array<
          Omit<Counts, 'visits' | 'rejectReasons' | 'amount'> & {
            variant: LeadVariant;
            productId: string;
            amount: string;
          }
        >
      >,
      this.db.query(
        `SELECT l.variant, l.product_id::text AS "productId", l.reject_reason AS reason, count(*)::int AS n
           FROM lead.lead l
          WHERE l.is_deleted = false AND l.created_at >= $1 AND l.created_at < $2
            AND l.merged_into_id IS NULL AND l.status = 'REJECTED' AND l.variant IS NOT NULL
            AND ($3::bigint IS NULL OR l.product_id = $3)
          GROUP BY 1, 2, 3`,
        params,
      ) as Promise<
        Array<{
          variant: LeadVariant;
          productId: string;
          reason: string;
          n: number;
        }>
      >,
    ]);

    const rows = new Map<
      string,
      Counts & { variant: LeadVariant; productId: string | null }
    >();
    const row = (variant: LeadVariant, productId: string | null) => {
      const key = `${variant}:${productId ?? '*'}`;
      let r = rows.get(key);
      if (!r) rows.set(key, (r = { variant, productId, ...empty() }));
      return r;
    };
    const add = (
      variant: LeadVariant,
      productId: string,
      f: (r: Counts) => void,
    ) => {
      f(row(variant, null));
      f(row(variant, productId));
    };
    for (const v of Object.values(LeadVariant)) row(v, null);
    for (const c of visits)
      add(c.variant, c.productId, (r) => (r.visits += c.n));
    for (const l of leads)
      add(l.variant, l.productId, (r) => {
        r.applications += l.applications;
        r.duplicates += l.duplicates;
        r.valid += l.valid;
        r.confirmed += l.confirmed;
        r.shipped += l.shipped;
        r.accepted += l.accepted;
        r.returned += l.returned;
        r.amount += Number(l.amount);
      });
    for (const x of rejects)
      add(x.variant, x.productId, (r) => {
        r.rejectReasons[x.reason] = (r.rejectReasons[x.reason] ?? 0) + x.n;
      });

    const productIds = [
      ...new Set(
        [...rows.values()]
          .map((r) => r.productId)
          .filter((p): p is string => !!p),
      ),
    ];
    const names = productIds.length
      ? new Map(
          (
            await this.catalog
              .list({ productIds })
              .catch(() => [] as CatalogOfferSnapshot[])
          ).map((o) => [o.productId, o.name]),
        )
      : new Map<string, string>();
    const out: VariantReportRowDto[] = [...rows.values()]
      .sort(
        (a, b) =>
          Number(a.productId !== null) - Number(b.productId !== null) ||
          (a.productId ?? '').localeCompare(b.productId ?? '', 'en', {
            numeric: true,
          }) ||
          a.variant.localeCompare(b.variant),
      )
      .map((r) => ({
        ...r,
        productName: r.productId ? (names.get(r.productId) ?? '') : 'Hammasi',
        duplicateRate: r.applications
          ? Math.round((r.duplicates * 1000) / r.applications) / 10
          : null,
        amountPer1000Visits: r.visits
          ? Math.round((r.amount * 1000) / r.visits)
          : null,
        targetReached:
          r.productId === null ? r.accepted >= VARIANT_TARGET_ACCEPTED : null,
      }));
    return {
      from,
      to,
      generatedAt: now,
      rows: out,
      targetAcceptedPerVariant: VARIANT_TARGET_ACCEPTED,
      targetReached: out
        .filter((r) => r.productId === null)
        .every((r) => r.targetReached),
      note: VARIANT_REPORT_NOTE,
    };
  }

  /** CSV (UTF-8 BOM, «;») — Excel uchun [taklif]. */
  async csv(
    query: VariantReportQueryDto,
  ): Promise<{ fileName: string; content: string }> {
    const r = await this.report(query);
    const header = [
      'Variant',
      'Mahsulot ID',
      'Mahsulot',
      'Tashrif',
      'Ariza',
      'Dublikat',
      'Dublikat %',
      'Yaroqli',
      'Tasdiq',
      'Jo‘natilgan',
      'Qabul qilingan',
      'Qaytarilgan',
      'Summa, so‘m',
      '1000 tashrifga, so‘m',
      'Rad sabablari',
      `Maqsad ${VARIANT_TARGET_ACCEPTED} posilka`,
    ];
    const lines = r.rows.map((x) =>
      [
        x.variant.toUpperCase(),
        x.productId ?? '',
        x.productName,
        x.visits,
        x.applications,
        x.duplicates,
        // «;» — o‘zbek/rus Excel; o‘nlik ajratgich vergul (5,8), aks holda sana bo‘lib ochiladi
        x.duplicateRate === null
          ? ''
          : String(x.duplicateRate).replace('.', ','),
        x.valid,
        x.confirmed,
        x.shipped,
        x.accepted,
        x.returned,
        x.amount,
        x.amountPer1000Visits ?? '',
        Object.entries(x.rejectReasons)
          .map(([k, n]) => `${k}: ${n}`)
          .join(', '),
        x.targetReached === null ? '' : x.targetReached ? 'yetdi' : 'yetmadi',
      ]
        .map((v) => csvCell(String(v)))
        .join(';'),
    );
    return {
      fileName: `s1-s3-sinov_${r.from}_${r.to}.csv`,
      content: '﻿' + [header.join(';'), ...lines].join('\r\n') + '\r\n',
    };
  }
}
