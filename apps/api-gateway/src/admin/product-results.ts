import { Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  AdminProductResultsDto,
  PLATFORM_METRICS_RPC,
  PlatformLeadMetricsDto,
  PlatformMetricsGroupBy,
  tashkentDate,
} from '@app/common';

/** Lid statistikasini kutish — ro‘yxat uning ortidan osilib qolmasin [taklif]. */
export const PRODUCT_RESULTS_TIMEOUT_MS = 3_000;
/** Kesh muddati [taklif; dizayn p-a2: statistika har soatda yangilanadi]. */
export const PRODUCT_RESULTS_TTL_MS = 5 * 60_000;
/** Xatodan keyin qayta so‘rashgacha [taklif] — lid servisi sekin bo‘lsa har ro‘yxat so‘rovi uni yuklamasin. */
export const PRODUCT_RESULTS_RETRY_MS = 60_000;
/** Davr: oxirgi 365 kun [taklif] — lead va moliya RPC chegarasi 366 kun; pilotning birinchi yili to‘liq kiradi. */
const WINDOW_DAYS = 365;

/**
 * BE-25 (FE-12): mahsulotlar ro‘yxatidagi «Natijalar» — hamma sotuvchilar bo‘yicha (`lead.stats.platform`, offer
 * kesimida; BE-28/BE-46 ta’riflari). Bitta so‘rov hamma mahsulot uchun, natija 5 daqiqa keshda. Javob bo‘lmasa —
 * oxirgi olingan natija (bo‘lmasa null) va 1 daqiqa qayta so‘ralmaydi.
 */
export class ProductResultsCache {
  private readonly logger = new Logger(ProductResultsCache.name);
  private cached: {
    at: number;
    value: Map<string, AdminProductResultsDto>;
  } | null = null;
  private pending: Promise<Map<string, AdminProductResultsDto> | null> | null =
    null;
  private failedAt: number | null = null;

  constructor(
    private readonly lead: ClientProxy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(): Promise<Map<string, AdminProductResultsDto> | null> {
    const at = this.now().getTime();
    if (this.cached && at - this.cached.at < PRODUCT_RESULTS_TTL_MS)
      return Promise.resolve(this.cached.value);
    if (this.failedAt !== null && at - this.failedAt < PRODUCT_RESULTS_RETRY_MS)
      return Promise.resolve(this.cached?.value ?? null);
    // bir vaqtdagi so‘rovlar bitta chaqiruvni kutadi
    this.pending ??= this.load(at).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async load(
    at: number,
  ): Promise<Map<string, AdminProductResultsDto> | null> {
    const to = tashkentDate(new Date(at));
    const from = tashkentDate(new Date(at - WINDOW_DAYS * 24 * 60 * 60_000));
    try {
      const result = await firstValueFrom(
        this.lead
          .send<PlatformLeadMetricsDto>(
            { cmd: PLATFORM_METRICS_RPC.LEADS },
            { from, to, groupBy: PlatformMetricsGroupBy.OFFER },
          )
          .pipe(timeout(PRODUCT_RESULTS_TIMEOUT_MS)),
      );
      const value = new Map<string, AdminProductResultsDto>();
      for (const row of result?.rows ?? []) {
        if (!/^\d+$/.test(String(row.key ?? ''))) continue;
        value.set(String(row.key), {
          leads: row.leads ?? 0,
          clicks: row.clicks ?? 0,
          validLeads: row.validLeads ?? 0,
          confirmed: row.confirmed,
          delivered: row.delivered,
          refused: row.refused,
          epc: row.epc,
          approveRate: row.approveRate,
          saleRate: row.saleRate,
          revenue: row.affiliateIncome ?? 0,
        });
      }
      this.cached = { at, value };
      this.failedAt = null;
      return value;
    } catch (error) {
      this.logger.warn(
        `Mahsulot natijalari olinmadi: ${(error as Error)?.message ?? error}`,
      );
      this.failedAt = at;
      return this.cached?.value ?? null;
    }
  }
}
