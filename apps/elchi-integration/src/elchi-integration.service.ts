import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { RmqClient } from '@app/common';
import { ElchiMarketProvision } from './entities/elchi-market-provision.entity';
import { GeoCache } from './entities/geo-cache.entity';
import { ElchiApiClient } from './elchi-api.client';
import { CreateElchiShipmentInput } from './elchi-api.client';

/** `shop.approved` event payloadi (loose contract — notification bilan bir xil shakl). */
export interface ShopApprovedEvent {
  sellerUserId?: string;
  shopId: string;
  shopName?: string;
  phone?: string | null;
  region_id?: string | null;
  district_id?: string | null;
}

const STATUS = { PENDING: 'pending', DONE: 'done', FAILED: 'failed' } as const;

@Injectable()
export class ElchiIntegrationService {
  private readonly logger = new Logger(ElchiIntegrationService.name);

  constructor(
    @InjectRepository(ElchiMarketProvision)
    private readonly provisionRepo: Repository<ElchiMarketProvision>,
    @InjectRepository(GeoCache)
    private readonly geoRepo: Repository<GeoCache>,
    @Inject(RmqClient.CATALOG) private readonly catalogClient: ClientProxy,
    private readonly elchi: ElchiApiClient,
  ) {}

  /**
   * Shop approve bo'lganda: Elchi'da market ochib, `elchi_market_id`ni shop'ga
   * yozadi. Idempotent — allaqachon `done` bo'lsa hech nima qilmaydi (2x market
   * ochilmaydi; Elchi tomoni ham external_seller_id bo'yicha idempotent).
   */
  async onShopApproved(event: ShopApprovedEvent): Promise<void> {
    const shopId = String(event?.shopId ?? '').trim();
    if (!shopId) {
      this.logger.warn('shop.approved: shopId yo‘q — o‘tkazib yuborildi');
      return;
    }

    let record = await this.provisionRepo.findOne({
      where: { shopId, isDeleted: false },
    });
    if (record?.status === STATUS.DONE && record.elchiMarketId) {
      return; // allaqachon provision qilingan — idempotent
    }
    if (!record) {
      record = await this.provisionRepo.save(
        this.provisionRepo.create({
          shopId,
          status: STATUS.PENDING,
          shopName: event.shopName ?? null,
          phone: event.phone ?? null,
          retryCount: 0,
        }),
      );
    }

    await this.attemptProvision(record);
  }

  /** Bitta provisioningni urinadi. Xatoda `failed` belgilaydi (retry cron uradi). */
  private async attemptProvision(record: ElchiMarketProvision): Promise<void> {
    try {
      const { elchi_market_id } = await this.elchi.provisionMarket({
        external_seller_id: record.shopId,
        name: record.shopName ?? `shop-${record.shopId}`,
        phone: record.phone ?? '',
      });

      record.elchiMarketId = elchi_market_id;
      record.status = STATUS.DONE;
      record.lastError = null;
      await this.provisionRepo.save(record);

      // elchi_market_id'ni shop'ga yozamiz (catalog egasi).
      await firstValueFrom(
        this.catalogClient.send(
          { cmd: 'catalog.shop.set-elchi-market-id' },
          { shopId: record.shopId, elchiMarketId: elchi_market_id },
        ),
      );
    } catch (error) {
      record.status = STATUS.FAILED;
      record.retryCount = (record.retryCount ?? 0) + 1;
      record.lastError = String((error as Error).message).slice(0, 500);
      await this.provisionRepo.save(record);
      this.logger.error(
        `market provision xato (shop=${record.shopId}, urinish=${record.retryCount}): ${record.lastError}`,
      );
      // rethrow YO'Q — retry cron qayta uradi (Elchi idempotent).
    }
  }

  /** Muvaffaqiyatsiz provisioninglarni davriy qayta uradi. */
  @Cron(CronExpression.EVERY_30_SECONDS, {
    name: 'elchi-market-provision-retry',
  })
  async retryFailedProvisions(): Promise<number> {
    const failed = await this.provisionRepo.find({
      where: { status: STATUS.FAILED, isDeleted: false },
      order: { updatedAt: 'ASC' },
      take: 20,
    });
    let recovered = 0;
    for (const record of failed) {
      await this.attemptProvision(record);
      if (record.status === STATUS.DONE) recovered++;
    }
    return recovered;
  }

  /**
   * Elchi viloyat/tuman ma'lumotini geo_cache'ga sinxronlaydi (upsert).
   * Marketplace manzilini Elchi region/district'ga moslash uchun.
   */
  async syncGeoCache(): Promise<{ regions: number; districts: number }> {
    const regions = await this.elchi.getRegions();
    for (const r of regions) {
      await this.upsertGeo('region', r.id, r.name, null);
    }

    const districts = await this.elchi.getDistricts();
    for (const d of districts) {
      await this.upsertGeo('district', d.id, d.name, d.region_id);
    }

    return { regions: regions.length, districts: districts.length };
  }

  createShipment(input: CreateElchiShipmentInput) {
    return this.elchi.createShipment(input);
  }

  private async upsertGeo(
    kind: 'region' | 'district',
    elchiId: string,
    name: string,
    elchiRegionId: string | null,
  ): Promise<void> {
    const existing = await this.geoRepo.findOne({ where: { kind, elchiId } });
    if (existing) {
      existing.name = name;
      existing.elchiRegionId = elchiRegionId;
      await this.geoRepo.save(existing);
    } else {
      await this.geoRepo.save(
        this.geoRepo.create({ kind, elchiId, name, elchiRegionId }),
      );
    }
  }
}
