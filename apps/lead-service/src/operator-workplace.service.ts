import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  CatalogOfferSnapshot,
  CheckoutDeliveryDestination,
  LeadOutcome,
  LeadRejectReason,
  LeadStatus,
  OperatorAttemptsPageDto,
  OperatorAttemptsQueryDto,
  OperatorLeadProductDto,
} from '@app/common';
import { CatalogOfferClient } from './catalog-offer.client';
import { Lead, OfferContent, Stream } from './entities';
import {
  clampToCallWindow,
  tashkentDayStart,
  tashkentParts,
} from './lead-schedule';
import { validDay } from './lead-stats.service';
import { CallService } from './telephony/call.service';

/** Mahsulot 8-bo‘limi: BAD — «Dori vositasi emas» yozuvi (product.dto `isBad` izohi, BE-07). */
export const BAD_WARNING = 'Dori vositasi emas';
const ATTEMPTS_DEFAULT_LIMIT = 10;
const ATTEMPTS_MAX_LIMIT = 100;

/**
 * BE-25 (FE-08 «operator ish joyi» taklifi, `docs/api-taklif/fe-08-operator.md`): mahsulot paneli va bugungi
 * urinishlar. Ma’lumot mavjud jadvallardan — yangi hisob yo‘q: urinishlar `lead_attempt` (GET /operator/stats bilan bir
 * xil to‘plam), mahsulot katalog nusxasidan va offer matnlaridan.
 */
@Injectable()
export class OperatorWorkplaceService {
  constructor(
    private readonly db: DataSource,
    private readonly catalog: CatalogOfferClient,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly calls?: CallService,
  ) {}

  /** «Mahsulot ma’lumoti» — faqat shu operatordagi (bron yoki rejalashtirilgan) lid; aks holda 404 (lid kartasi kabi). */
  async product(
    operatorId: string,
    leadId: string,
  ): Promise<OperatorLeadProductDto> {
    const lead = await this.db
      .getRepository(Lead)
      .findOne({ where: { id: leadId, isDeleted: false } });
    if (
      !lead ||
      lead.operatorId !== operatorId ||
      ![LeadStatus.BOOKED, LeadStatus.CALLBACK].includes(lead.status)
    )
      throw new NotFoundException('Lid topilmadi yoki bu operatorda emas');
    const [offer, content, stream] = await Promise.all([
      this.catalog.get(lead.productId).catch(() => null),
      this.db.getRepository(OfferContent).findOne({
        where: { productId: lead.productId, isDeleted: false },
      }),
      lead.streamId
        ? this.db
            .getRepository(Stream)
            .findOne({ where: { id: lead.streamId } })
        : Promise.resolve(null),
    ]);
    return productView(lead, offer, content, stream?.code ?? null, (code) =>
      this.pageUrl(code),
    );
  }

  /** Bugungi (yoki tanlangan kunlardagi) urinishlarim: yangisi birinchi; `total` — davrdagi hammasi. */
  async attempts(
    operatorId: string,
    query: OperatorAttemptsQueryDto = {},
    now = new Date(),
  ): Promise<OperatorAttemptsPageDto> {
    // sana tekshiruvi GET /operator/stats bilan bir xil (2026-02-30 kabi sana — 400, total ular bilan teng bo‘lsin)
    const from = validDay(query.from ?? tashkentToday(now), 'from');
    const to = validDay(query.to ?? from, 'to');
    if (from > to) throw new BadRequestException('from to dan katta');
    const limit = Math.min(
      ATTEMPTS_MAX_LIMIT,
      Math.max(1, Number(query.limit ?? ATTEMPTS_DEFAULT_LIMIT) || 1),
    );
    const range = [operatorId, tashkentDayStart(from), tashkentDayStart(to, 1)];
    const [rows, [{ total }]] = await Promise.all([
      this.db.query(
        `SELECT a.created_at AS "at", a.lead_id::text AS "leadId", a.outcome, a.comment,
                a.call_id AS "callId", a.callback_at AS "callbackAt", l.name AS "customerName", l.product_id::text AS "productId",
                l.reject_reason AS "rejectReason", l.next_attempt_at AS "nextAttemptAt", l.status,
                a.id = (SELECT max(a2.id) FROM lead.lead_attempt a2 WHERE a2.lead_id = a.lead_id) AS "latest"
           FROM lead.lead_attempt a JOIN lead.lead l ON l.id = a.lead_id
          WHERE a.operator_id = $1 AND a.created_at >= $2 AND a.created_at < $3
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT $4`,
        [...range, limit],
      ) as Promise<AttemptRow[]>,
      this.db.query(
        `SELECT count(*)::int AS total FROM lead.lead_attempt a
          WHERE a.operator_id = $1 AND a.created_at >= $2 AND a.created_at < $3`,
        range,
      ) as Promise<Array<{ total: number }>>,
    ]);
    const offers = rows.length
      ? await this.catalog
          .list({ productIds: [...new Set(rows.map((r) => r.productId))] })
          .catch(() => [] as CatalogOfferSnapshot[])
      : [];
    const names = new Map(offers.map((o) => [o.productId, o.name]));
    // BE-15 (TEL-3): davomiylik va yozuv holati
    const calls = await this.calls?.forAttempts(rows.map((r) => r.callId));
    return {
      items: rows.map((r) => ({
        at: new Date(r.at).toISOString(),
        leadId: r.leadId,
        customerName: r.customerName,
        productName: names.get(r.productId) ?? '',
        outcome: r.outcome,
        comment: r.comment,
        rejectReason: rejectReasonOf(r),
        nextAttemptAt: nextAttemptOf(r),
        durationSeconds: calls?.get(r.callId ?? '')?.durationSeconds ?? null,
        call: r.callId ? (calls?.get(r.callId) ?? null) : null,
      })),
      total,
    };
  }

  /** Sotuvchi sahifasi havolasi — `StreamService.link` bilan bir xil (`LEAD_LANDING_BASE_URL`, EQ-05). */
  private pageUrl(code: string): string | null {
    const base = (this.config?.get<string>('LEAD_LANDING_BASE_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    return base ? `${base}/${code}` : null;
  }
}

interface AttemptRow {
  at: Date;
  leadId: string;
  callId: string | null;
  outcome: LeadOutcome;
  comment: string | null;
  callbackAt: Date | null;
  customerName: string;
  productId: string;
  rejectReason: LeadRejectReason | null;
  nextAttemptAt: Date | null;
  status: LeadStatus;
  latest: boolean;
}

/**
 * Keyingi qo‘ng‘iroq. Shu lidning oxirgi urinishi va lid hali qayta qo‘ng‘iroqda bo‘lsa — lidning haqiqiy navbatdagi
 * vaqti (09:00–21:00 ga surilgan; «Javob bermadi · 14:31», «Keyinroq · ertaga 09:00»). Eski urinishda — o‘sha paytda
 * mijoz aytgan vaqt, qo‘ng‘iroq oynasiga surilgan holda. Boshqa holatda — null.
 */
export function nextAttemptOf(
  r: Pick<AttemptRow, 'callbackAt' | 'latest' | 'status' | 'nextAttemptAt'>,
): string | null {
  if (r.latest && r.status === LeadStatus.CALLBACK && r.nextAttemptAt)
    return new Date(r.nextAttemptAt).toISOString();
  if (r.callbackAt)
    return clampToCallWindow(new Date(r.callbackAt)).toISOString();
  return null;
}

/**
 * Rad sababi lidda saqlanadi (urinishda emas): faqat shu urinish lidning oxirgisi va lid hali rad etilgan bo‘lsa
 * ko‘rsatiladi — lid qayta ochilgan yoki keyin boshqa sabab bilan rad etilgan bo‘lsa eski urinishga noto‘g‘ri sabab
 * chiqmasin.
 */
export function rejectReasonOf(
  r: Pick<AttemptRow, 'outcome' | 'latest' | 'status' | 'rejectReason'>,
): LeadRejectReason | null {
  return r.outcome === LeadOutcome.REJECTED &&
    r.latest &&
    r.status === LeadStatus.REJECTED
    ? r.rejectReason
    : null;
}

export function productView(
  lead: Pick<Lead, 'productId' | 'salePrice'>,
  offer: CatalogOfferSnapshot | null,
  content: Pick<OfferContent, 'highlights' | 'boxContents'> | null,
  streamCode: string | null,
  pageUrl: (code: string) => string | null,
): OperatorLeadProductDto {
  const box = content?.boxContents ?? [];
  return {
    id: lead.productId,
    name: offer?.name ?? '',
    category: offer?.categoryName ?? null,
    imageUrl: offer?.images?.[0] ?? null,
    description: offer?.description ?? null,
    highlights: content?.highlights ?? [],
    available: offer?.stock ?? null,
    weightKg: offer?.weightGrams == null ? null : offer.weightGrams / 1000,
    contents: box.length ? box.join(', ') : null,
    salePrice: Number(lead.salePrice),
    // katalog javob bermasa — null (0 so‘m deb ko‘rsatilmasin)
    deliveryFee: offer
      ? ({
          [CheckoutDeliveryDestination.CENTER]: offer.centerDeliveryFee,
          [CheckoutDeliveryDestination.ADDRESS]: offer.addressDeliveryFee,
        } as Record<CheckoutDeliveryDestination, number>)
      : null,
    pageUrl: streamCode ? pageUrl(streamCode) : null,
    warning: offer?.isBad ? BAD_WARNING : null,
  };
}

/** Bugungi Toshkent sanasi «YYYY-MM-DD» (LeadStatsService.todayTashkent bilan bir xil). */
export function tashkentToday(now: Date): string {
  const t = tashkentParts(now);
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}
