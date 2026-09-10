import { BadRequestException } from '@nestjs/common';
import { PlatformSettings } from '../entities/platform-settings.entity';
import { PlatformSettingsService } from './platform-settings.service';

describe('PlatformSettingsService (C6.2)', () => {
  function setup() {
    const row = {
      id: 1,
      commissionPercent: 5,
      minimumOrderAmount: 10000,
      supportPhone: '',
      updatedBy: null,
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    } as PlatformSettings;
    const activitySave = jest.fn(async (value) => value);
    const settingsRepo = {
      findOneByOrFail: jest.fn(async () => row),
      createQueryBuilder: jest.fn(() => ({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOneOrFail: jest.fn(async () => row),
      })),
      save: jest.fn(async (value: PlatformSettings) => {
        value.updatedAt = new Date('2026-09-08T12:00:00.000Z');
        return value;
      }),
    };
    const activityRepo = {
      create: jest.fn((value) => value),
      save: activitySave,
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === PlatformSettings ? settingsRepo : activityRepo,
      ),
    };
    const dataSource = {
      getRepository: jest.fn(() => settingsRepo),
      transaction: jest.fn(async (work) => work(manager)),
    };
    return {
      row,
      activitySave,
      activityRepo,
      settingsRepo,
      manager,
      dataSource,
      service: new PlatformSettingsService(dataSource as never),
    };
  }

  it('TC1: joriy sozlamalarni qaytaradi', async () => {
    const { service } = setup();
    await expect(service.get()).resolves.toMatchObject({
      commissionPercent: 5,
      minimumOrderAmount: 10000,
      supportPhone: '',
    });
  });

  it('TC2: o‘zgarishni saqlaydi va shu tranzaksiyada audit yozadi', async () => {
    const { service, dataSource, settingsRepo, activityRepo, activitySave } =
      setup();
    const dto = {
      commissionPercent: 7.5,
      minimumOrderAmount: 50000,
      supportPhone: '+998712000000',
    };

    const result = await service.update('17', dto, '127.0.0.1');

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(settingsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ ...dto, updatedBy: '17' }),
    );
    expect(activityRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: '17',
        action: 'platform.settings.update',
        entityType: 'PlatformSettings',
        entityId: '1',
        meta: expect.objectContaining({
          before: expect.objectContaining({ commissionPercent: 5 }),
          after: expect.objectContaining({ commissionPercent: 7.5 }),
          ip: '127.0.0.1',
        }),
      }),
    );
    expect(activitySave).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject(dto);
    await expect(service.get()).resolves.toMatchObject(dto);
  });

  it('TC3: noto‘g‘ri qiymatni tranzaksiyadan oldin rad etadi', async () => {
    const { service, dataSource } = setup();
    await expect(
      service.update(
        '17',
        {
          commissionPercent: 101,
          minimumOrderAmount: 0,
          supportPhone: '',
        },
        '127.0.0.1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
