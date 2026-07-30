import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Warehouse } from './entities/warehouse.entity';
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  WarehouseOwnerType,
} from '@app/common';

@Injectable()
export class WarehouseService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehouses: Repository<Warehouse>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(shopId: string): Promise<Warehouse[]> {
    const warehouses = await this.warehouses.find({
      where: {
        ownerType: WarehouseOwnerType.SHOP,
        ownerId: shopId,
        isActive: true,
      },
      order: {
        isDefault: 'DESC',
        createdAt: 'ASC',
      },
    });
    return warehouses;
  }

  async createWarehouse(
    shopId: string,
    dto: CreateWarehouseDto,
  ): Promise<Warehouse> {
    return this.dataSource.transaction(async (manager) => {
      const warehouseRepo = manager.getRepository(Warehouse);
      const warehouseCount = await warehouseRepo.count({
        where: {
          ownerType: WarehouseOwnerType.SHOP,
          ownerId: shopId,
          isActive: true,
        },
      });

      const shouldBeDefault = warehouseCount === 0 || dto.isDefault === true;

      if (shouldBeDefault) {
        await warehouseRepo.update(
          {
            ownerType: WarehouseOwnerType.SHOP,
            ownerId: shopId,
            isDefault: true,
          },
          {
            isDefault: false,
          },
        );
      }

      const warehouse = warehouseRepo.create({
        ownerType: WarehouseOwnerType.SHOP,
        ownerId: shopId,
        name: dto.name,
        regionId: dto.regionId ?? null,
        districtId: dto.districtId ?? null,
        address: dto.address ?? null,
        isDefault: shouldBeDefault,
        isActive: true,
      });

      return warehouseRepo.save(warehouse);
    });
  }

  async findOne(shopId: string, warehouseId: string): Promise<Warehouse> {
    const warehouse = await this.warehouses.findOne({
      where: {
        id: warehouseId,
        ownerType: WarehouseOwnerType.SHOP,
        ownerId: shopId,
        isActive: true,
      },
    });

    if (!warehouse) {
      throw new NotFoundException('Bunday ombor topilmadi');
    }
    return warehouse;
  }

  async assertOwned(shopId: string, warehouseId: string): Promise<void> {
    const warehouse = await this.warehouses.findOne({
      where: { id: warehouseId, isActive: true },
    });
    if (!warehouse) {
      throw new NotFoundException('Bunday ombor topilmadi');
    }
    if (
      warehouse.ownerType !== WarehouseOwnerType.SHOP ||
      warehouse.ownerId !== shopId
    ) {
      throw new ForbiddenException('Bu ombor sizga tegishli emas');
    }
  }

  async updateWarehouse(
    shopId: string,
    warehouseId: string,
    dto: UpdateWarehouseDto,
  ): Promise<Warehouse> {
    return this.dataSource.transaction(async (manager) => {
      const warehouseRepo = manager.getRepository(Warehouse);
      const warehouse = await warehouseRepo.findOne({
        where: {
          id: warehouseId,
          ownerType: WarehouseOwnerType.SHOP,
          ownerId: shopId,
          isActive: true,
        },
      });
      if (!warehouse) {
        throw new NotFoundException('Bunday ombor topilmadi');
      }

      if (dto.isDefault === true && !warehouse.isDefault) {
        await warehouseRepo.update(
          {
            ownerType: WarehouseOwnerType.SHOP,
            ownerId: shopId,
            isDefault: true,
          },
          { isDefault: false },
        );
        warehouse.isDefault = true;
      }

      if (dto.name !== undefined) warehouse.name = dto.name;
      if (dto.regionId !== undefined) warehouse.regionId = dto.regionId;
      if (dto.districtId !== undefined) warehouse.districtId = dto.districtId;
      if (dto.address !== undefined) warehouse.address = dto.address;

      return warehouseRepo.save(warehouse);
    });
  }

  async removeWarehouse(
    shopId: string,
    warehouseId: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.dataSource.transaction(async (manager) => {
      const warehouseRepo = manager.getRepository(Warehouse);
      const warehouse = await warehouseRepo.findOne({
        where: {
          id: warehouseId,
          ownerType: WarehouseOwnerType.SHOP,
          ownerId: shopId,
          isActive: true,
        },
      });
      if (!warehouse) {
        throw new NotFoundException('Bunday ombor topilmadi');
      }

      warehouse.isActive = false;
      warehouse.isDefault = false;
      await warehouseRepo.save(warehouse);

      if (
        warehouse.isDefault ||
        !(await warehouseRepo.existsBy({
          ownerType: WarehouseOwnerType.SHOP,
          ownerId: shopId,
          isDefault: true,
          isActive: true,
        }))
      ) {
        const nextDefault = await warehouseRepo.findOne({
          where: {
            ownerType: WarehouseOwnerType.SHOP,
            ownerId: shopId,
            isActive: true,
          },
          order: { createdAt: 'ASC' },
        });
        if (nextDefault) {
          nextDefault.isDefault = true;
          await warehouseRepo.save(nextDefault);
        }
      }

      return { id: warehouseId, deleted: true };
    });
  }
}
