import { BadRequestException, Injectable } from '@nestjs/common';
import { ActivityLog, UpdateAdminSettingsDto } from '@app/common';
import { DataSource, Repository } from 'typeorm';
import { PlatformSettings } from '../entities/platform-settings.entity';

export interface PlatformSettingsView {
  commissionPercent: number;
  minimumOrderAmount: number;
  supportPhone: string;
  updatedBy: string | null;
  updatedAt: Date;
}

@Injectable()
export class PlatformSettingsService {
  constructor(private readonly dataSource: DataSource) {}

  async get(): Promise<PlatformSettingsView> {
    const settings = await this.dataSource
      .getRepository(PlatformSettings)
      .findOneByOrFail({ id: 1 });
    return this.view(settings);
  }

  async update(
    actorId: string,
    dto: UpdateAdminSettingsDto,
    ip?: string,
  ): Promise<PlatformSettingsView> {
    this.assertValid(dto);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PlatformSettings);
      const settings = await this.lockedSettings(repo);
      const before = this.view(settings);

      settings.commissionPercent = dto.commissionPercent;
      settings.minimumOrderAmount = dto.minimumOrderAmount;
      settings.supportPhone = dto.supportPhone;
      settings.updatedBy = actorId;
      const saved = await repo.save(settings);
      const after = this.view(saved);

      await manager.getRepository(ActivityLog).save(
        manager.getRepository(ActivityLog).create({
          actorId,
          action: 'platform.settings.update',
          entityType: 'PlatformSettings',
          entityId: '1',
          meta: { before, after, ip: ip ?? null },
        }),
      );
      return after;
    });
  }

  private lockedSettings(
    repo: Repository<PlatformSettings>,
  ): Promise<PlatformSettings> {
    return repo
      .createQueryBuilder('settings')
      .setLock('pessimistic_write')
      .where('settings.id = :id', { id: 1 })
      .getOneOrFail();
  }

  private assertValid(dto: UpdateAdminSettingsDto): void {
    if (
      !Number.isFinite(dto?.commissionPercent) ||
      dto.commissionPercent < 0 ||
      dto.commissionPercent > 100 ||
      !Number.isFinite(dto?.minimumOrderAmount) ||
      dto.minimumOrderAmount < 0 ||
      !/^(?:|\+998\d{9})$/.test(dto?.supportPhone)
    ) {
      throw new BadRequestException('Platforma sozlamalari noto‘g‘ri');
    }
  }

  private view(settings: PlatformSettings): PlatformSettingsView {
    return {
      commissionPercent: Number(settings.commissionPercent),
      minimumOrderAmount: Number(settings.minimumOrderAmount),
      supportPhone: settings.supportPhone,
      updatedBy: settings.updatedBy,
      updatedAt: settings.updatedAt,
    };
  }
}
