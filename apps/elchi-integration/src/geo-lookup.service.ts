import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LeadAddressResolution, LeadRegionGroupDto } from '@app/common';
import { ElchiIntegrationService } from './elchi-integration.service';
import { GeoCache } from './entities/geo-cache.entity';

/**
 * Sotuvchi sahifasi formasi va operator uchun geo qidiruv (BE-38). Manba — Elchi geo keshi:
 * kalit SOATO (EQ-06), tuman o‘z viloyatiga `elchi_region_id` orqali bog‘langan.
 * Kesh bo‘sh bo‘lsagina Elchi bilan sinxronlanadi: noto‘g‘ri kod Elchi API siga so‘rov yubormaydi.
 */
@Injectable()
export class GeoLookupService {
  constructor(
    @InjectRepository(GeoCache) private readonly geoRepo: Repository<GeoCache>,
    private readonly integration: ElchiIntegrationService,
  ) {}

  /** GET /regions/tree: viloyatlar va ularning tumanlari, Elchi tartibida. */
  async regionTree(): Promise<LeadRegionGroupDto[]> {
    let rows = await this.activeRows();
    if (
      !rows.some((r) => r.kind === 'region') ||
      rows.some((r) => !r.satoCode)
    ) {
      await this.integration.syncGeoCache();
      rows = await this.activeRows();
    }
    const districtsByRegion = new Map<string, GeoCache[]>();
    for (const row of rows) {
      if (row.kind !== 'district' || !row.satoCode || !row.elchiRegionId)
        continue;
      const list = districtsByRegion.get(String(row.elchiRegionId)) ?? [];
      list.push(row);
      districtsByRegion.set(String(row.elchiRegionId), list);
    }
    return rows
      .filter((r) => r.kind === 'region' && r.satoCode)
      .map((region) => ({
        satoCode: String(region.satoCode),
        name: region.name,
        districts: (districtsByRegion.get(String(region.elchiId)) ?? []).map(
          (d) => ({ satoCode: String(d.satoCode), name: d.name }),
        ),
      }));
  }

  /** Viloyat va tuman SOATO kodini tekshiradi va nomlarini qaytaradi. */
  async resolveAddress(input: {
    regionSoato: string;
    districtSoato: string;
  }): Promise<LeadAddressResolution> {
    let rows = await this.findBySoato(input);
    if (rows.length === 0 && (await this.isCacheEmpty())) {
      await this.integration.syncGeoCache();
      rows = await this.findBySoato(input);
    }
    const region = rows.find(
      (r) => r.kind === 'region' && r.satoCode === input.regionSoato,
    );
    if (!region)
      return {
        ok: false,
        field: 'regionSoato',
        error: 'regionSoato bunday viloyat topilmadi',
      };
    const districts = rows.filter(
      (r) => r.kind === 'district' && r.satoCode === input.districtSoato,
    );
    if (districts.length === 0)
      return {
        ok: false,
        field: 'districtSoato',
        error:
          'districtSoato bunday tuman topilmadi yoki Elchi u yerga yetkazmaydi',
      };
    const district = districts.find(
      (d) => String(d.elchiRegionId) === String(region.elchiId),
    );
    if (!district)
      return {
        ok: false,
        field: 'districtSoato',
        error: 'districtSoato tanlangan viloyatga tegishli emas',
      };
    return {
      ok: true,
      regionSoato: input.regionSoato,
      regionName: region.name,
      districtSoato: input.districtSoato,
      districtName: district.name,
      elchiRegionId: String(region.elchiId),
      elchiDistrictId: String(district.elchiId),
    };
  }

  private activeRows(): Promise<GeoCache[]> {
    return this.geoRepo.find({
      where: { kind: In(['region', 'district']), isDeleted: false },
      order: { elchiId: 'ASC' },
    });
  }

  private findBySoato(input: {
    regionSoato: string;
    districtSoato: string;
  }): Promise<GeoCache[]> {
    return this.geoRepo.find({
      where: [
        { kind: 'region', satoCode: input.regionSoato, isDeleted: false },
        { kind: 'district', satoCode: input.districtSoato, isDeleted: false },
      ],
    });
  }

  private async isCacheEmpty(): Promise<boolean> {
    return (await this.geoRepo.count({ where: { isDeleted: false } })) === 0;
  }
}
