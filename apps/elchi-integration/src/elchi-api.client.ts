import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElchiShipmentResult } from '@app/common';

export interface ElchiRegion {
  id: string;
  name: string;
  sato_code: string;
}
export interface ElchiDistrict {
  id: string;
  name: string;
  region_id: string;
  sato_code: string;
}

export interface CreateElchiShipmentInput {
  external_order_id: string;
  elchi_market_id: string;
  customer: { name: string; phone: string };
  address: string;
  region_id?: string | null;
  district_id?: string | null;
  where_deliver?: string;
  items: Array<{
    name: string;
    quantity: number;
    /** Mahsulot ID si — Elchi nom bo'yicha emas, shu bo'yicha bog'laydi (BE-20). */
    external_product_id?: string;
    /** Bir dona og'irligi, kg (Elchi `items[].weight_kg`, ixtiyoriy) — BE-20 TC3. */
    weight_kg?: number;
  }>;
  cod_amount: number;
}

/** Posilka yaratish kutishi: Elchi gateway ning 65 s chegarasidan uzunroq. */
const SHIPMENT_CREATE_TIMEOUT_MS = 70_000;

/** Elchi HTTP xatosi: `status` bo'yicha qayta urinish yoki rad qaror qilinadi. */
export class ElchiApiError extends Error {
  /** Elchi xato kodi, masalan `ORDER_INTAKE_CLOSED` (bugungi qabul yopiq). */
  readonly code: string | null;
  /** `ORDER_INTAKE_CLOSED` da: qachon qayta urinish mumkin (ISO). */
  readonly reopensAt: string | null;

  constructor(
    readonly status: number,
    message: string,
    body?: unknown,
  ) {
    super(message);
    const b = (body ?? {}) as Record<string, any>;
    const code = b.code ?? b.data?.code ?? b.error?.code;
    const reopensAt = b.reopens_at ?? b.data?.reopens_at;
    this.code = typeof code === 'string' ? code : null;
    this.reopensAt = typeof reopensAt === 'string' ? reopensAt : null;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface ElchiTariffInput {
  elchi_market_id: string;
  where_deliver?: 'center' | 'address';
}

/**
 * Elchi `where_deliver` uchun faqat 'center' va 'address' ni biladi. Bizda bu
 * qiymat bazadan katta harfda ('ADDRESS') keladi, tashqi manbalardan esa
 * umuman kelmasligi mumkin — shuning uchun kichik harfga keltirib, notanish
 * qiymatda xavfsiz `'address'` ga qaytamiz.
 */
function normalizeWhereDeliver(value?: string | null): 'center' | 'address' {
  return String(value ?? '')
    .trim()
    .toLowerCase() === 'center'
    ? 'center'
    : 'address';
}

/**
 * Elchi Partner API HTTP klienti (marketplace tomoni). Native `fetch`, autentifikatsiya
 * `X-Api-Key` header bilan (Elchi PartnerApiKeyGuard shu header'ni kutadi — C1.2).
 * Kalit env'dan (`ELCHI_PARTNER_API_KEY`) — server sekret sifatida. Kontrakt:
 * Elchi-Backend/docs/PARTNER_API.md §3.
 */
@Injectable()
export class ElchiApiClient {
  private readonly logger = new Logger(ElchiApiClient.name);
  private readonly partnerApiUrl: string;
  private readonly partnerApiKey: string;

  constructor(private readonly config: ConfigService) {
    // Bu qiymatlarni birinchi so'rov kelguncha kutib tekshirish xavfli: servis
    // readiness'da "ok" ko'rinib, checkout paytida 500 qaytarib qoladi. Client
    // Nest bootstrapida yaratiladi, demak noto'g'ri production config servisni
    // darhol yiqitadi va gateway readiness elchi-integration'ni `down` qiladi.
    this.partnerApiUrl = this.config
      .getOrThrow<string>('ELCHI_PARTNER_API_URL')
      .replace(/\/+$/, '');
    this.partnerApiKey = this.config.getOrThrow<string>(
      'ELCHI_PARTNER_API_KEY',
    );
  }

  private baseUrl(): string {
    return this.partnerApiUrl;
  }

  private apiKey(): string {
    return this.partnerApiKey;
  }

  /** POST /partner/markets — sotuvchi uchun market provisioning (idempotent). */
  async provisionMarket(body: {
    external_seller_id: string;
    name: string;
    phone: string;
    region_id?: string | null;
    district_id?: string | null;
    tariff_home?: number;
    tariff_center?: number;
  }): Promise<{ elchi_market_id: string }> {
    const res = await this.request('POST', '/partner/markets', body);
    const id = this.pluck(res, 'elchi_market_id');
    if (!id) {
      throw new Error('Elchi javobida elchi_market_id yo‘q');
    }
    return { elchi_market_id: String(id) };
  }

  /** POST /partner/shipments — external_order_id Elchi tomonida idempotency kaliti. */
  async createShipment(
    body: CreateElchiShipmentInput,
  ): Promise<ElchiShipmentResult> {
    // `where_deliver` ni Elchi faqat KICHIK harfda qabul qiladi
    // ('center' yoki 'address'), aks holda butun so'rovni 400 bilan rad etadi.
    // Bizning `checkout.sales_order.where_deliver` ustuni esa 'ADDRESS' saqlaydi
    // (migratsiyadagi DEFAULT katta harfda). Ikkala chaqiruvchi ham qiymatni
    // bazadan o'zgartirmasdan uzatgani uchun productionda HAR QANDAY posilka
    // yaratish yiqilardi:
    //   POST /partner/shipments → 400 "where_deliver must be one of the
    //   following values: center, address"
    // Normalizatsiya ataylab shu yerda — Elchi'ga chiqadigan yagona nuqta,
    // demak kelajakdagi chaqiruvchilar ham avtomatik himoyalanadi.
    // `getTariff` allaqachon shu qoidaga amal qiladi.
    // Elchi gateway posilka yaratishni 65 s gacha kutadi
    // (Elchi-Backend `partner-gateway.controller.ts`, PARTNER_SHIPMENT_TIMEOUT_MS):
    // undan oldin uzib qayta yuborsak, Elchi takror kalitni saqlashga ulgurmay
    // ikkinchi posilka yaratishi mumkin. Shuning uchun kutish undan uzunroq.
    const res = await this.request(
      'POST',
      '/partner/shipments',
      {
        ...body,
        where_deliver: normalizeWhereDeliver(body.where_deliver),
      },
      SHIPMENT_CREATE_TIMEOUT_MS,
    );
    const id = this.pluck(res, 'shipment_id');
    if (!id) throw new Error('Elchi javobida shipment_id yo‘q');
    const trackingUrl = this.pluck(res, 'tracking_url');
    // `qr_code_token` — pochta posilkani skanerlab qabul qiladigan kalit.
    // Elchi uni javobda qaytaradi (PARTNER_API.md §3.3), lekin avval biz uni
    // tashlab yuborardik. Yorliqdagi QR ichiga aynan shu yoziladi — C1.45.
    const qrToken = this.pluck(res, 'qr_code_token');
    const toBePaid = this.money(this.pluck(res, 'to_be_paid'));
    if (!qrToken) {
      // Takroriy (idempotent) javobda Elchi buyurtmani o'qiy olmasa faqat
      // { shipment_id, idempotent: true } qaytaradi — QR va summa yo'q
      // (Elchi-Backend `idempotentShipmentRes`). Ularni GET dan olamiz;
      // GET xatosi chaqiruvchiga o'tadi va so'rov qayta uriniladi (BE-20).
      const shipment = await this.getShipment(String(id));
      return {
        shipment_id: String(id),
        ...(trackingUrl ? { tracking_url: String(trackingUrl) } : {}),
        ...(shipment.qr_code_token
          ? { qr_code_token: shipment.qr_code_token }
          : {}),
        ...(toBePaid !== undefined
          ? { to_be_paid: toBePaid }
          : shipment.to_be_paid !== undefined
            ? { to_be_paid: shipment.to_be_paid }
            : {}),
      };
    }
    return {
      shipment_id: String(id),
      ...(trackingUrl ? { tracking_url: String(trackingUrl) } : {}),
      ...(qrToken ? { qr_code_token: String(qrToken) } : {}),
      ...(toBePaid !== undefined ? { to_be_paid: toBePaid } : {}),
    };
  }

  /**
   * GET /partner/shipments/:id — mavjud posilkaning tokeni va summasi.
   *
   * Posilka yaratish javobida token yo'qolgan satrlarni tiklash uchun (C1.45):
   * `createShipment` qayta chaqirilmaydi, chunki bizda shipment id bor bo'lsa
   * u darhol qaytib ketadi. Elchi bu endpointda tokenni `tracking` nomi bilan
   * beradi (`integration-service.service.ts` getPartnerShipment), summani esa
   * `cod_amount` (= `to_be_paid`) nomi bilan — ikkala nomni ham qabul qilamiz.
   */
  async getShipment(shipmentId: string): Promise<ElchiShipmentResult> {
    const res = await this.request(
      'GET',
      `/partner/shipments/${encodeURIComponent(shipmentId)}`,
    );
    const id = this.pluck(res, 'shipment_id');
    if (!id) throw new Error('Elchi javobida shipment_id yo‘q');
    const qrToken =
      this.pluck(res, 'qr_code_token') ?? this.pluck(res, 'tracking');
    const toBePaid = this.money(
      this.pluck(res, 'to_be_paid') ?? this.pluck(res, 'cod_amount'),
    );
    return {
      shipment_id: String(id),
      ...(qrToken ? { qr_code_token: String(qrToken) } : {}),
      ...(toBePaid !== undefined ? { to_be_paid: toBePaid } : {}),
    };
  }

  /** GET /partner/regions → [{id, name, sato_code}]. */
  async getRegions(): Promise<ElchiRegion[]> {
    const res = await this.request('GET', '/partner/regions');
    return this.list(res).map((r) => ({
      id: this.requiredGeoValue(r, ['id'], 'region id'),
      name: this.requiredGeoValue(r, ['name'], 'region name'),
      sato_code: this.requiredGeoValue(
        r,
        ['sato_code', 'soato_code', 'soato', 'sato'],
        'region sato_code',
      ),
    }));
  }

  /** GET /partner/districts?region_id= → [{id, name, region_id, sato_code}]. */
  async getDistricts(regionId?: string): Promise<ElchiDistrict[]> {
    const path = regionId
      ? `/partner/districts?region_id=${encodeURIComponent(regionId)}`
      : '/partner/districts';
    const res = await this.request('GET', path);
    return this.list(res).map((d) => ({
      id: this.requiredGeoValue(d, ['id'], 'district id'),
      name: this.requiredGeoValue(d, ['name'], 'district name'),
      region_id: this.requiredGeoValue(d, ['region_id'], 'district region_id'),
      sato_code: this.requiredGeoValue(
        d,
        ['sato_code', 'soato_code', 'soato', 'sato'],
        'district sato_code',
      ),
    }));
  }

  /** GET /partner/tariff — bitta yoki bir nechta posilka yetkazish narxi. */
  async getTariff(input: ElchiTariffInput): Promise<{ amount: number }> {
    const query = new URLSearchParams();
    query.set('elchi_market_id', input.elchi_market_id);
    query.set('where_deliver', input.where_deliver ?? 'address');
    const res = await this.request('GET', `/partner/tariff?${query}`);
    const raw =
      this.pluck(res, 'amount') ??
      this.pluck(res, 'market_tariff') ??
      this.pluck(res, 'price') ??
      this.pluck(res, 'tariff') ??
      this.pluck(res, 'delivery_price');
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error('Elchi javobida yaroqli tarif summasi yo‘q');
    }
    // Pul bizda butun so'mda (BE-01); Elchi "25000.00" ko'rinishida yuborishi
    // mumkin, shuning uchun yaxlitlanadi.
    return { amount: Math.round(parsed) };
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 15_000,
  ): Promise<unknown> {
    const url = `${this.baseUrl()}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new ElchiApiError(
        response.status,
        `Elchi API ${method} ${path} → ${response.status}: ${text}`,
        parseJson(text),
      );
    }
    return text ? (JSON.parse(text) as unknown) : null;
  }

  /**
   * POST /partner/shipments/:id/cancel — posilkani bekor qilish (BE-20 TC5).
   * Elchi takroriy bekor qilishga 200 qaytaradi; yetkazilganini bekor qilishga
   * 409 (Elchi-Backend `partner-gateway.controller.ts`, `cancelShipment`).
   */
  async cancelShipment(shipmentId: string): Promise<void> {
    await this.request(
      'POST',
      `/partner/shipments/${encodeURIComponent(shipmentId)}/cancel`,
    );
  }

  /** Javob envelopeidan (turli chuqurlik) qiymatni topadi. */
  private pluck(res: unknown, key: string): unknown {
    const r = res as Record<string, any> | null;
    return r?.[key] ?? r?.data?.[key] ?? r?.data?.data?.[key] ?? undefined;
  }

  /**
   * Summa maydoni: yo'q yoki son bo'lmasa `undefined` (0 ni saqlaydi).
   * Butun so'mga yaxlitlanadi — checkout ustuni BIGINT (BE-01).
   */
  private money(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount) : undefined;
  }

  /** Javobdan massivni ajratadi (`data` yoki `data.data` yoki to‘g‘ridan). */
  private list(res: unknown): Array<Record<string, any>> {
    const r = res as Record<string, any> | null;
    const arr = Array.isArray(r)
      ? r
      : Array.isArray(r?.data)
        ? r.data
        : Array.isArray(r?.data?.data)
          ? r.data.data
          : [];
    return arr as Array<Record<string, any>>;
  }

  private requiredGeoValue(
    row: Record<string, any>,
    keys: string[],
    label: string,
  ): string {
    for (const key of keys) {
      const value = row[key];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    throw new Error(`Elchi geo javobida ${label} yo‘q`);
  }
}
