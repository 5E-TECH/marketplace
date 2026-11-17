import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  AffiliateCapiDeliveriesPageDto,
  AffiliateCapiDeliveryDto,
  AffiliateCapiEvent,
  AffiliatePostbackStatus,
  decryptSecret,
  LeadSource,
} from '@app/common';
import { CapiDelivery, Click, Lead, Stream } from './entities';
import { POSTBACK_RULES, postbackRetryAt } from './postback.service';

/**
 * Meta Conversions API qoidalari (BE-31). Qayta urinish postback bilan bir xil (5 urinish, 2^(n-1) daqiqa — BE-14).
 * Meta 7 kundan eski hodisani rad etadi (server-event `event_time`) — undan eski qator FAILED.
 */
export const CAPI_RULES = {
  maxAgeMs: 7 * 24 * 3600 * 1000,
  /** Graph API versiyasi sozlamada: `META_GRAPH_VERSION` (2026-11: v26.0 — oqish-meta.md). */
  defaultGraphVersion: 'v26.0',
  currency: 'UZS',
} as const;

/**
 * Qayta urinmaslik kerak bo‘lgan Graph xato kodlari (oqish-meta.md: error-handling): 190 — token, 102 — sessiya,
 * 100 — noto‘g‘ri parametr, 200–299 — ruxsat. Qolganlari (1, 2, 4, 17, 341, 368, 5xx, tarmoq) — qayta urinish.
 */
export function isPermanentGraphError(code: number | undefined): boolean {
  return (
    code === 190 ||
    code === 102 ||
    code === 100 ||
    (!!code && code >= 200 && code <= 299)
  );
}

/** Telefon: faqat raqamlar, mamlakat kodi bilan (+998901234567 → 998901234567), SHA-256 hex (Meta `ph`). */
export function hashPhone(e164: string): string {
  return createHash('sha256').update(e164.replace(/\D/g, '')).digest('hex');
}

/** `_fbc` cookie bo‘lmasa fbclid dan: fb.1.<birinchi ko‘rilgan vaqt, ms>.<fbclid> (Meta fbp-and-fbc). */
export function fbcFrom(
  fbc: string | null | undefined,
  fbclid: string | null | undefined,
  seenAt: Date,
): string | undefined {
  if (fbc) return fbc;
  return fbclid ? `fb.1.${seenAt.getTime()}.${fbclid}` : undefined;
}

export interface CapiEventInput {
  event: AffiliateCapiEvent;
  leadId: string;
  orderId: string | null;
  productId: string;
  quantity: number;
  eventTime: Date;
  sourceUrl: string;
  ip: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | undefined;
  phoneE164: string | null;
  sendPhone: boolean;
  value: number | null;
}

/**
 * Bitta server hodisasi. event_id = lid ID: brauzer pikselidagi eventID bilan bir xil — Meta bitta hodisa
 * deb hisoblaydi (TC4). Purchase da ham lid ID (event_name boshqa — to‘qnashmaydi).
 * Telefon faqat `sendPhone` bo‘lsa (EQ-10 yuridik tekshiruvi — T01:473; sukut o‘chiq).
 */
export function buildCapiEvent(input: CapiEventInput): Record<string, unknown> {
  const userData: Record<string, unknown> = {};
  if (input.ip) userData.client_ip_address = input.ip;
  if (input.userAgent) userData.client_user_agent = input.userAgent;
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;
  if (input.sendPhone && input.phoneE164)
    userData.ph = [hashPhone(input.phoneE164)];
  const purchase = input.event === AffiliateCapiEvent.PURCHASE;
  return {
    event_name: purchase ? 'Purchase' : 'Lead',
    event_time: Math.floor(input.eventTime.getTime() / 1000),
    event_id: input.leadId,
    action_source: 'website',
    event_source_url: input.sourceUrl,
    user_data: userData,
    custom_data: purchase
      ? {
          value: input.value ?? 0,
          currency: CAPI_RULES.currency,
          content_type: 'product',
          content_ids: [input.productId],
          contents: [{ id: input.productId, quantity: input.quantity }],
          ...(input.orderId ? { order_id: input.orderId } : {}),
        }
      : { content_type: 'product', content_ids: [input.productId] },
  };
}

export interface CapiResponse {
  status: number;
  body: unknown;
}
export type CapiSender = (
  url: string,
  body: Record<string, unknown>,
) => Promise<CapiResponse>;

/** POST JSON; token so‘rov tanasida (URL da emas — loglarga tushmaydi). */
export const sendCapi: CapiSender = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(POSTBACK_RULES.timeoutMs),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
};

const short = (s: string) => (s.length > 500 ? `${s.slice(0, 497)}...` : s);

/**
 * Meta Conversions API (BE-31; SOT-5). Lead — yangi lid (postback LEAD bilan bir joyda), Purchase — buyurtma
 * birinchi marta yetkazilganda (BE-28 `order.status.changed` iste’molchisi). Faqat sotuvchi sahifasi lidlari:
 * API lidida IP va brauzer sotuvchi serveriniki [taklif]. Sahifada piksel ID va CAPI tokeni bo‘lishi kerak.
 * Yuborish `LEAD_CAPI=on` bilan yoqiladi; navbat va jurnal — `capi_delivery` (lead_id + event unikal).
 */
@Injectable()
export class CapiService {
  private readonly logger = new Logger(CapiService.name);
  sender: CapiSender = sendCapi;

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  /** Yangi lid (tekshiruvdagi ariza va dublikat — yo‘q; chaqiruvchi tekshiradi). */
  enqueueLead(
    manager: EntityManager,
    lead: Pick<Lead, 'id' | 'streamId' | 'source' | 'createdAt'>,
  ): Promise<void> {
    return this.enqueue(
      manager,
      lead,
      AffiliateCapiEvent.LEAD,
      lead.createdAt ?? new Date(),
      null,
    );
  }

  /** Yetkazildi: summa — mijoz to‘lagan jami (COD), so‘m [taklif; dizayn p-s6 «292 000»]. */
  enqueuePurchase(
    manager: EntityManager,
    lead: Pick<Lead, 'id' | 'streamId' | 'source'>,
    value: number,
    at: Date,
  ): Promise<void> {
    return this.enqueue(manager, lead, AffiliateCapiEvent.PURCHASE, at, value);
  }

  private async enqueue(
    manager: EntityManager,
    lead: Pick<Lead, 'id' | 'streamId' | 'source'>,
    event: AffiliateCapiEvent,
    eventTime: Date,
    value: number | null,
  ): Promise<void> {
    if (lead.source !== LeadSource.LANDING || !lead.streamId) return;
    const stream = await manager
      .getRepository(Stream)
      .findOne({ where: { id: lead.streamId } });
    if (!stream?.metaPixelId || !stream.capiTokenEnc) return;
    await manager
      .createQueryBuilder()
      .insert()
      .into(CapiDelivery)
      .values({
        leadId: lead.id,
        streamId: stream.id,
        event,
        attempts: 0,
        nextAttemptAt: new Date(),
        eventTime,
        value:
          value !== null && Number.isSafeInteger(value) && value >= 0
            ? String(value)
            : null,
      })
      .orIgnore()
      .execute();
  }

  @Cron(CronExpression.EVERY_30_SECONDS, {
    name: 'lead-capi',
    waitForCompletion: true,
  })
  async run(): Promise<void> {
    if (this.config.get<string>('LEAD_CAPI') !== 'on') return;
    try {
      await this.sendDue();
    } catch (error) {
      this.logger.error(`CAPI yuborish xato: ${(error as Error).message}`);
    }
  }

  /** Vaqti kelganlarni qisqa tranzaksiyada band qiladi, HTTP ni tranzaksiyadan tashqarida yuboradi (BE-14 namunasi). */
  async sendDue(now = new Date()): Promise<number> {
    const claimed = await this.db.transaction(async (manager) => {
      const rows = await manager
        .getRepository(CapiDelivery)
        .createQueryBuilder('d')
        .where('d.delivered_at IS NULL AND d.next_attempt_at <= :now', { now })
        .orderBy('d.next_attempt_at', 'ASC')
        .take(POSTBACK_RULES.batch)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      if (rows.length)
        await manager
          .getRepository(CapiDelivery)
          .update(
            { id: In(rows.map((r) => r.id)) },
            { nextAttemptAt: new Date(now.getTime() + POSTBACK_RULES.leaseMs) },
          );
      return rows;
    });
    let sent = 0;
    for (const row of claimed) if (await this.deliver(row, now)) sent++;
    return sent;
  }

  private async fail(
    row: CapiDelivery,
    reason: string,
    extra: Partial<CapiDelivery> = {},
  ) {
    await this.db
      .getRepository(CapiDelivery)
      .update(row.id, {
        nextAttemptAt: null,
        lastError: short(reason),
        ...extra,
      });
  }

  private landingUrl(code: string): string {
    const base = (
      this.config.get<string>('LEAD_LANDING_BASE_URL') ?? ''
    ).replace(/\/+$/, '');
    return `${base}/${code}`;
  }

  private async deliver(row: CapiDelivery, now: Date): Promise<boolean> {
    const repo = this.db.getRepository(CapiDelivery);
    const [lead, stream] = await Promise.all([
      this.db.getRepository(Lead).findOne({ where: { id: row.leadId } }),
      this.db.getRepository(Stream).findOne({ where: { id: row.streamId } }),
    ]);
    if (!lead || !stream?.metaPixelId || !stream.capiTokenEnc) {
      await this.fail(row, 'Sahifada piksel ID yoki CAPI tokeni yo‘q');
      return false;
    }
    if (!/^\d{1,32}$/.test(stream.metaPixelId)) {
      await this.fail(row, 'Piksel ID noto‘g‘ri');
      return false;
    }
    const eventTime = row.eventTime ?? row.createdAt;
    if (now.getTime() - eventTime.getTime() > CAPI_RULES.maxAgeMs) {
      await this.fail(row, 'Hodisa 7 kundan eski — Meta qabul qilmaydi');
      return false;
    }
    let token: string;
    try {
      token = decryptSecret(
        stream.capiTokenEnc,
        this.config.getOrThrow<string>('INTEGRATION_CREDENTIAL_SECRET'),
      );
    } catch {
      await this.fail(
        row,
        'CAPI tokenini ochib bo‘lmadi — tokenni qayta kiriting',
      );
      return false;
    }
    const click = lead.clickId
      ? await this.db
          .getRepository(Click)
          .findOne({ where: { id: lead.clickId } })
      : null;
    const body: Record<string, unknown> = {
      data: [
        buildCapiEvent({
          event: row.event as AffiliateCapiEvent,
          leadId: lead.id,
          orderId: lead.orderId,
          productId: lead.productId,
          quantity: lead.quantity,
          eventTime,
          sourceUrl: this.landingUrl(stream.code),
          ip: lead.ip,
          userAgent: lead.userAgent,
          fbp: click?.fbp ?? null,
          fbc: fbcFrom(
            click?.fbc,
            lead.fbclid ?? click?.fbclid,
            click?.createdAt ?? lead.createdAt,
          ),
          phoneE164: lead.phoneE164,
          sendPhone: this.config.get<string>('LEAD_CAPI_SEND_PHONE') === 'on',
          value: row.value === null ? null : Number(row.value),
        }),
      ],
      access_token: token,
    };
    const testCode = this.config.get<string>('LEAD_CAPI_TEST_EVENT_CODE');
    if (testCode) body.test_event_code = testCode;
    const version =
      this.config.get<string>('META_GRAPH_VERSION') ||
      CAPI_RULES.defaultGraphVersion;
    const url = `https://graph.facebook.com/${version}/${stream.metaPixelId}/events`;

    const attempts = row.attempts + 1;
    let res: CapiResponse | null = null;
    let networkError: string | null = null;
    try {
      res = await this.sender(url, body);
    } catch (err) {
      networkError = (err as Error).message || 'tarmoq xatosi';
    }
    const received = (res?.body as { events_received?: number } | null)
      ?.events_received;
    if (res && res.status >= 200 && res.status < 300 && (received ?? 0) >= 1) {
      await repo.update(row.id, {
        attempts,
        responseCode: res.status,
        deliveredAt: now,
        nextAttemptAt: null,
        lastError: null,
      });
      return true;
    }
    const error = (
      res?.body as { error?: { code?: number; message?: string } } | null
    )?.error;
    const reason = networkError
      ? `Tarmoq: ${networkError}`
      : error
        ? `${error.code ?? res?.status}: ${error.message ?? 'Meta xatosi'}`
        : `HTTP ${res?.status}`;
    const permanent = !!error && isPermanentGraphError(error.code);
    await repo.update(row.id, {
      attempts,
      responseCode: res?.status ?? null,
      lastError: short(reason.replace(token, '***')),
      nextAttemptAt:
        permanent || attempts >= POSTBACK_RULES.maxAttempts
          ? null
          : postbackRetryAt(attempts, now),
    });
    return false;
  }

  /** Sotuvchi jurnali (FE-28): hodisa, holat, urinishlar, javob kodi va xato sababi. */
  async journal(
    affiliateId: string,
    query: { page?: number; limit?: number; streamId?: string },
  ): Promise<AffiliateCapiDeliveriesPageDto> {
    const page = Math.max(1, Math.trunc(Number(query.page)) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Math.trunc(Number(query.limit)) || 20),
    );
    const qb = this.db
      .getRepository(CapiDelivery)
      .createQueryBuilder('d')
      .innerJoin(Stream, 's', 's.id = d.stream_id')
      .where('s.affiliate_id = :affiliateId', { affiliateId });
    if (query.streamId)
      qb.andWhere('d.stream_id = :sid', { sid: query.streamId });
    const [rows, total] = await qb
      .orderBy('d.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const codes = new Map(
      (
        await this.db.getRepository(Stream).find({
          where: { id: In([...new Set(rows.map((r) => r.streamId))]) },
        })
      ).map((s) => [s.id, s.code]),
    );
    return {
      items: rows.map((r): AffiliateCapiDeliveryDto => ({
        id: r.id,
        leadId: r.leadId,
        streamCode: codes.get(r.streamId) ?? '',
        event: r.event as AffiliateCapiEvent,
        status: r.deliveredAt
          ? AffiliatePostbackStatus.SENT
          : r.nextAttemptAt
            ? AffiliatePostbackStatus.PENDING
            : AffiliatePostbackStatus.FAILED,
        attempts: r.attempts,
        responseCode: r.responseCode,
        lastError: r.lastError,
        value: r.value === null ? null : Number(r.value),
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
        createdAt: r.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
