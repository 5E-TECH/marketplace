import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ElchiRegion {
  id: string;
  name: string;
}
export interface ElchiDistrict {
  id: string;
  name: string;
  region_id: string;
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

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    return this.config
      .getOrThrow<string>('ELCHI_PARTNER_API_URL')
      .replace(/\/+$/, '');
  }

  private apiKey(): string {
    return this.config.getOrThrow<string>('ELCHI_PARTNER_API_KEY');
  }

  /** POST /partner/markets — sotuvchi uchun market provisioning (idempotent). */
  async provisionMarket(body: {
    external_seller_id: string;
    name: string;
    phone: string;
    region_id?: string | null;
    district_id?: string | null;
  }): Promise<{ elchi_market_id: string }> {
    const res = await this.request('POST', '/partner/markets', body);
    const id = this.pluck(res, 'elchi_market_id');
    if (!id) {
      throw new Error('Elchi javobida elchi_market_id yo‘q');
    }
    return { elchi_market_id: String(id) };
  }

  /** GET /partner/regions → [{id, name}]. */
  async getRegions(): Promise<ElchiRegion[]> {
    const res = await this.request('GET', '/partner/regions');
    return this.list(res).map((r) => ({
      id: String(r.id),
      name: String(r.name),
    }));
  }

  /** GET /partner/districts?region_id= → [{id, name, region_id}]. */
  async getDistricts(regionId?: string): Promise<ElchiDistrict[]> {
    const path = regionId
      ? `/partner/districts?region_id=${encodeURIComponent(regionId)}`
      : '/partner/districts';
    const res = await this.request('GET', path);
    return this.list(res).map((d) => ({
      id: String(d.id),
      name: String(d.name),
      region_id: String(d.region_id),
    }));
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.baseUrl()}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Elchi API ${method} ${path} → ${response.status}: ${text}`,
      );
    }
    return text ? (JSON.parse(text) as unknown) : null;
  }

  /** Javob envelopeidan (turli chuqurlik) qiymatni topadi. */
  private pluck(res: unknown, key: string): unknown {
    const r = res as Record<string, any> | null;
    return r?.[key] ?? r?.data?.[key] ?? r?.data?.data?.[key] ?? undefined;
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
}
