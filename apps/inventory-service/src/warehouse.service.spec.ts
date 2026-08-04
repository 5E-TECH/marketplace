import { ForbiddenException } from '@nestjs/common';
import { WarehouseOwnerType } from '@app/common';
import { Warehouse } from './entities/warehouse.entity';
import { WarehouseService } from './warehouse.service';

describe('WarehouseService', () => {
  it('TC1: birinchi ombor avtomatik default bo‘ladi', async () => {
    const createdWarehouse = {
      id: '1',
      ownerType: WarehouseOwnerType.SHOP,
      ownerId: '15',
      name: 'Asosiy ombor',
      regionId: null,
      districtId: null,
      address: null,
      isDefault: true,
      isActive: true,
    } as Warehouse;
    const warehouseRepo = {
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockResolvedValue(createdWarehouse),
    };
    const dataSource = {
      transaction: jest.fn((callback) =>
        callback({
          getRepository: jest.fn().mockReturnValue(warehouseRepo),
        }),
      ),
    };
    const service = new WarehouseService({} as never, dataSource as never);

    const result = await service.createWarehouse('15', {
      name: 'Asosiy ombor',
    });

    expect(warehouseRepo.count).toHaveBeenCalledWith({
      where: {
        ownerType: WarehouseOwnerType.SHOP,
        ownerId: '15',
        isActive: true,
      },
    });
    expect(warehouseRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: '15',
        name: 'Asosiy ombor',
        isDefault: true,
        isActive: true,
      }),
    );
    expect(result.isDefault).toBe(true);
  });

  it('begona seller omborini 403 bilan rad etadi', async () => {
    const warehouseRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: '3',
        ownerType: WarehouseOwnerType.SHOP,
        ownerId: '99',
        isActive: true,
      }),
    };
    const service = new WarehouseService(warehouseRepo as never, {} as never);

    await expect(service.assertOwned('15', '3')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
