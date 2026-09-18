import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { CheckoutDeliveryDestination, RmqClient } from '@app/common';
import { ElchiMarketProvision } from './entities/elchi-market-provision.entity';
import { GeoCache } from './entities/geo-cache.entity';
import {
  CreateElchiShipmentInput,
  ElchiApiClient,
  ElchiDistrict,
  ElchiRegion,
} from './elchi-api.client';

/** `shop.approved` event payloadi (loose contract — notification bilan bir xil shakl). */
export interface ShopApprovedEvent {
  sellerUserId?: string;
  shopId: string;
  shopName?: string;
  phone?: string | null;
  region_id?: string | null;
  district_id?: string | null;
  regionId?: string | null;
  districtId?: string | null;
  tariffHome?: number;
  tariffCenter?: number;
}

interface CatalogShop {
  id: string;
  name: string;
  phone: string | null;
  regionId: string | null;
  districtId: string | null;
  tariffHome: number;
  tariffCenter: number;
  elchiMarketId: string | null;
}

export interface GeoSyncResult {
  regions: number;
  districts: number;
  added: number;
  updated: number;
  deleted: number;
}

export interface UpdateMarketTariffsInput {
  shopId: string;
  shopName: string;
  phone?: string | null;
  regionId?: string | null;
  districtId?: string | null;
  tariffHome: number;
  tariffCenter: number;
}

export interface MarketTariffSyncResult {
  total: number;
  updated: number;
  failed: number;
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
          regionId: event.regionId ?? event.region_id ?? null,
          districtId: event.districtId ?? event.district_id ?? null,
          tariffHome: Number(event.tariffHome ?? 0),
          tariffCenter: Number(event.tariffCenter ?? 0),
          retryCount: 0,
        }),
      );
    } else {
      // Qayta kelgan approve eventi retry snapshotini yangi ma'lumot bilan
      // yangilaydi; DONE holati yuqorida allaqachon qaytarilgan.
      record.shopName = event.shopName ?? record.shopName;
      record.phone = event.phone ?? record.phone;
      record.regionId =
        event.regionId ?? event.region_id ?? record.regionId ?? null;
      record.districtId =
        event.districtId ?? event.district_id ?? record.districtId ?? null;
      record.tariffHome = Number(event.tariffHome ?? record.tariffHome ?? 0);
      record.tariffCenter = Number(
        event.tariffCenter ?? record.tariffCenter ?? 0,
      );
      await this.provisionRepo.save(record);
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
        region_id: record.regionId,
        district_id: record.districtId,
        tariff_home: Number(record.tariffHome ?? 0),
        tariff_center: Number(record.tariffCenter ?? 0),
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
   * C1.46 backfill — integratsiya qo‘shilishidan oldin yaratilgan barcha Elchi
   * marketlarini catalogdagi joriy tariflar bilan qayta provision qiladi.
   * Elchi external_seller_id bo‘yicha idempotent yangilaydi; yangi market
   * ochilmaydi. Xato yozuv FAILED bo‘ladi va odatiy retry cron davom ettiradi.
   */
  async syncMarketTariffs(): Promise<MarketTariffSyncResult> {
    const records = await this.provisionRepo.find({
      where: { status: STATUS.DONE, isDeleted: false },
      order: { shopId: 'ASC' },
    });
    const result: MarketTariffSyncResult = {
      total: records.length,
      updated: 0,
      failed: 0,
    };

    for (const record of records) {
      try {
        const shop = await this.getCatalogShop(record.shopId);
        const update = await this.updateMarketTariffs({
          shopId: shop.id,
          shopName: shop.name,
          phone: shop.phone,
          regionId: shop.regionId,
          districtId: shop.districtId,
          tariffHome: Number(shop.tariffHome),
          tariffCenter: Number(shop.tariffCenter),
        });
        if (update.updated) result.updated++;
        else result.failed++;
      } catch (error) {
        result.failed++;
        this.logger.error(
          `market tariff sync xato (shop=${record.shopId}): ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Market tariff sync yakunlandi: total=${result.total}, updated=${result.updated}, failed=${result.failed}`,
    );
    return result;
  }

  /** Har kuni drift va eski marketlarni avtomatik tuzatadi. */
  @Cron('0 30 2 * * *', {
    name: 'elchi-market-tariff-daily-sync',
    timeZone: 'Asia/Tashkent',
  })
  async syncMarketTariffsDaily(): Promise<void> {
    try {
      await this.syncMarketTariffs();
    } catch (error) {
      this.logger.error(
        `Kunlik market tariff sync xato: ${(error as Error).message}`,
      );
    }
  }

  /**
   * C1.46 — mavjud Elchi market uchun idempotent provisioning so‘rovini yangi
   * tariflar bilan takrorlaydi. Elchi shu external_seller_id marketini yangilaydi;
   * xatoda snapshot FAILED bo‘lib, odatiy cron orqali qayta urinadi.
   */
  async updateMarketTariffs(
    input: UpdateMarketTariffsInput,
  ): Promise<{ updated: boolean; status: string }> {
    const shopId = String(input.shopId);
    let record = await this.provisionRepo.findOne({
      where: { shopId, isDeleted: false },
    });
    if (!record) {
      record = this.provisionRepo.create({
        shopId,
        elchiMarketId: null,
        retryCount: 0,
        lastError: null,
      });
    }
    record.shopName = input.shopName;
    record.phone = input.phone ?? null;
    record.regionId = input.regionId ?? null;
    record.districtId = input.districtId ?? null;
    record.tariffHome = Number(input.tariffHome);
    record.tariffCenter = Number(input.tariffCenter);
    record.status = STATUS.PENDING;
    record = await this.provisionRepo.save(record);

    await this.attemptProvision(record);
    return { updated: record.status === STATUS.DONE, status: record.status };
  }

  /** C6.7 — bitta do‘konni catalogdagi joriy ma’lumot bilan qayta provision. */
  async reprovisionMarket(shopId: string) {
    const shop = await this.getCatalogShop(String(shopId));
    const result = await this.updateMarketTariffs({
      shopId: shop.id,
      shopName: shop.name,
      phone: shop.phone,
      regionId: shop.regionId,
      districtId: shop.districtId,
      tariffHome: Number(shop.tariffHome),
      tariffCenter: Number(shop.tariffCenter),
    });
    const record = await this.provisionRepo.findOne({
      where: { shopId: String(shopId), isDeleted: false },
    });
    return {
      shopId: String(shopId),
      elchiMarketId: record?.elchiMarketId ?? null,
      status: result.status,
      reprovisioned: result.updated,
      error: record?.lastError ?? null,
    };
  }

  /**
   * Elchi viloyat/tuman ma'lumotini geo_cache'ga sinxronlaydi (upsert).
   * Marketplace manzilini Elchi region/district'ga moslash uchun.
   */
  async syncGeoCache(): Promise<GeoSyncResult> {
    // Ikkala tashqi so‘rov ham muvaffaqiyatli bo‘lmaguncha bazani o‘zgartirmaymiz.
    const [regions, districts] = await Promise.all([
      this.elchi.getRegions(),
      this.elchi.getDistricts(),
    ]);
    if (regions.length === 0 || districts.length === 0) {
      throw new Error(
        'Elchi geo ro‘yxati bo‘sh qaytdi; mavjud cache o‘zgartirilmadi',
      );
    }

    const existing = await this.geoRepo.find();
    const byKey = new Map(
      existing.map((row) => [`${row.kind}:${row.elchiId}`, row]),
    );
    const activeKeys = new Set<string>();
    let added = 0;
    let updated = 0;
    let deleted = 0;

    for (const region of regions) {
      const counts = await this.reconcileGeoRow(
        byKey,
        activeKeys,
        'region',
        region,
        null,
      );
      added += counts.added;
      updated += counts.updated;
    }
    for (const district of districts) {
      const counts = await this.reconcileGeoRow(
        byKey,
        activeKeys,
        'district',
        district,
        district.region_id,
      );
      added += counts.added;
      updated += counts.updated;
    }

    for (const row of existing) {
      const key = `${row.kind}:${row.elchiId}`;
      if (!activeKeys.has(key) && !row.isDeleted) {
        row.isDeleted = true;
        await this.geoRepo.save(row);
        deleted++;
      }
    }

    const result = {
      regions: regions.length,
      districts: districts.length,
      added,
      updated,
      deleted,
    };
    this.logger.log(
      `Geo sync yakunlandi: regions=${result.regions}, districts=${result.districts}, added=${added}, updated=${updated}, deleted=${deleted}`,
    );
    return result;
  }

  /** C1.44 — Elchi geo keshini har kuni Toshkent vaqti bilan 02:00 da yangilaydi. */
  @Cron('0 0 2 * * *', {
    name: 'elchi-geo-cache-daily-sync',
    timeZone: 'Asia/Tashkent',
  })
  async syncGeoCacheDaily(): Promise<void> {
    try {
      await this.syncGeoCache();
    } catch (error) {
      this.logger.error(`Kunlik geo sync xato: ${(error as Error).message}`);
    }
  }

  async getRegions(): Promise<
    Array<{ id: string; name: string; satoCode: string }>
  > {
    let regions = await this.geoRepo.find({
      where: { kind: 'region', isDeleted: false },
      order: { elchiId: 'ASC' },
    });
    if (regions.length === 0 || regions.some((row) => !row.satoCode)) {
      await this.syncGeoCache();
      regions = await this.geoRepo.find({
        where: { kind: 'region', isDeleted: false },
        order: { elchiId: 'ASC' },
      });
    }
    return regions.map((r) => ({
      id: String(r.elchiId),
      name: r.name,
      satoCode: String(r.satoCode),
    }));
  }

  async getDistricts(
    regionId: string,
  ): Promise<
    Array<{ id: string; regionId: string; name: string; satoCode: string }>
  > {
    let districts = await this.geoRepo.find({
      where: {
        kind: 'district',
        elchiRegionId: String(regionId),
        isDeleted: false,
      },
      order: { elchiId: 'ASC' },
    });
    const needsSatoBackfill = districts.some((row) => !row.satoCode);
    if (needsSatoBackfill) {
      await this.syncGeoCache();
      districts = await this.geoRepo.find({
        where: {
          kind: 'district',
          elchiRegionId: String(regionId),
          isDeleted: false,
        },
        order: { elchiId: 'ASC' },
      });
    } else if (districts.length === 0) {
      const totalDistricts = await this.geoRepo.count({
        where: { kind: 'district', isDeleted: false },
      });
      if (totalDistricts === 0) {
        await this.syncGeoCache();
        districts = await this.geoRepo.find({
          where: {
            kind: 'district',
            elchiRegionId: String(regionId),
            isDeleted: false,
          },
          order: { elchiId: 'ASC' },
        });
      }
    }
    return districts.map((d) => ({
      id: String(d.elchiId),
      regionId: String(d.elchiRegionId ?? regionId),
      name: d.name,
      satoCode: String(d.satoCode),
    }));
  }

  /**
   * `shopId` berilsa u Elchi market id'siga o'giriladi.
   *
   * NEGA SHU YERDA: marketplace'ning ICHKI do'kon id'si (masalan 4) va Elchi
   * market id'si (masalan 142) — boshqa-boshqa raqamlar. Moslashtirish shu
   * servisning zimmasida. `seller-orders.service.ts` da catalog klienti yo'q,
   * shuning uchun u faqat `shopId` ni bila oladi va avval uni `elchi_market_id`
   * maydoniga solib yuborardi. Natijada Elchi 403 qaytarardi:
   *   "elchi_market_id shu hamkorga tegishli emas"
   * ya'ni sotuvchi kabinetidan posilka yaratish umuman ishlamasdi.
   *
   * `elchi_market_id` to'g'ridan-to'g'ri berilgan chaqiruvchilar
   * (`confirm-sales-order.service.ts`) o'zgarishsiz ishlayveradi.
   */
  async createShipment(
    input: CreateElchiShipmentInput & { shopId?: string },
  ): Promise<{ shipment_id: string; tracking_url?: string }> {
    const { shopId, ...body } = input;
    if (shopId) {
      body.elchi_market_id = await this.resolveElchiMarketId(shopId);
    }
    return this.elchi.createShipment(body);
  }

  async getTariff(input: {
    shopId: string;
    regionId?: string | null;
    districtId?: string | null;
    whereDeliver?: CheckoutDeliveryDestination;
  }) {
    return this.elchi.getTariff({
      elchi_market_id: await this.resolveElchiMarketId(input.shopId),
      where_deliver:
        input.whereDeliver === CheckoutDeliveryDestination.CENTER
          ? 'center'
          : 'address',
    });
  }

  /** Marketplace do'kon id'si → Elchi market id'si. Bog'lanmagan bo'lsa ulaydi. */
  private async resolveElchiMarketId(shopId: string): Promise<string> {
    let shop = await this.getCatalogShop(shopId);
    if (!shop.elchiMarketId) {
      // Integratsiyadan oldin approve qilingan production do'konlarini birinchi
      // murojaatdayoq idempotent tarzda Elchi'ga ulaymiz. Keyingi so'rovlarda
      // catalogdagi saqlangan ID to'g'ridan-to'g'ri ishlatiladi.
      await this.onShopApproved({
        shopId: shop.id,
        shopName: shop.name,
        phone: shop.phone,
        region_id: shop.regionId,
        district_id: shop.districtId,
        tariffHome: Number(shop.tariffHome ?? 0),
        tariffCenter: Number(shop.tariffCenter ?? 0),
      });
      shop = await this.getCatalogShop(shopId);
    }
    if (!shop.elchiMarketId) {
      throw new Error(`Do‘kon ${shopId} Elchi bilan bog‘lanmadi`);
    }
    return shop.elchiMarketId;
  }

  private getCatalogShop(shopId: string): Promise<CatalogShop> {
    return firstValueFrom(
      this.catalogClient.send<CatalogShop>(
        { cmd: 'catalog.shop.get-by-id' },
        { shopId },
      ),
    );
  }

  private async reconcileGeoRow(
    byKey: Map<string, GeoCache>,
    activeKeys: Set<string>,
    kind: 'region' | 'district',
    source: ElchiRegion | ElchiDistrict,
    elchiRegionId: string | null,
  ): Promise<{ added: number; updated: number }> {
    const key = `${kind}:${source.id}`;
    activeKeys.add(key);
    const existing = byKey.get(key);
    if (!existing) {
      const created = this.geoRepo.create({
        kind,
        elchiId: source.id,
        name: source.name,
        satoCode: source.sato_code,
        elchiRegionId,
        isDeleted: false,
      });
      await this.geoRepo.save(created);
      byKey.set(key, created);
      return { added: 1, updated: 0 };
    }

    const restored = existing.isDeleted;
    const changed =
      existing.name !== source.name ||
      existing.satoCode !== source.sato_code ||
      existing.elchiRegionId !== elchiRegionId ||
      restored;
    if (!changed) return { added: 0, updated: 0 };

    existing.name = source.name;
    existing.satoCode = source.sato_code;
    existing.elchiRegionId = elchiRegionId;
    existing.isDeleted = false;
    await this.geoRepo.save(existing);
    return { added: restored ? 1 : 0, updated: restored ? 0 : 1 };
  }
}
