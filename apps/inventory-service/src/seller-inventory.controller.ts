import { Controller, Inject, UseFilters } from '@nestjs/common';
import { ClientProxy, MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateWarehouseDto,
  RmqClient,
  RpcHttpExceptionFilter,
  sendRpc,
  StockQueryDto,
  UpdateWarehouseDto,
} from '@app/common';
import { StockQueryService } from './stock-query.service';
import { WarehouseService } from './warehouse.service';

interface SellerShop {
  id: string;
}

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class SellerInventoryController {
  constructor(
    private readonly warehouses: WarehouseService,
    private readonly stock: StockQueryService,
    @Inject(RmqClient.CATALOG)
    private readonly catalog: ClientProxy,
  ) {}

  @MessagePattern({ cmd: 'inventory.warehouse.list' })
  async listWarehouses(@Payload() data: { ownerUserId: string }) {
    const shopId = await this.shopId(data.ownerUserId);
    return this.warehouses.findAll(shopId);
  }

  @MessagePattern({ cmd: 'inventory.warehouse.get-one' })
  async getWarehouse(
    @Payload() data: { ownerUserId: string; warehouseId: string },
  ) {
    const shopId = await this.shopId(data.ownerUserId);
    return this.warehouses.findOne(shopId, data.warehouseId);
  }

  @MessagePattern({ cmd: 'inventory.warehouse.create' })
  async createWarehouse(
    @Payload() data: { ownerUserId: string; dto: CreateWarehouseDto },
  ) {
    const shopId = await this.shopId(data.ownerUserId);
    return this.warehouses.createWarehouse(shopId, data.dto);
  }

  @MessagePattern({ cmd: 'inventory.warehouse.update' })
  async updateWarehouse(
    @Payload()
    data: {
      ownerUserId: string;
      warehouseId: string;
      dto: UpdateWarehouseDto;
    },
  ) {
    const shopId = await this.shopId(data.ownerUserId);
    return this.warehouses.updateWarehouse(shopId, data.warehouseId, data.dto);
  }

  @MessagePattern({ cmd: 'inventory.warehouse.delete' })
  async deleteWarehouse(
    @Payload() data: { ownerUserId: string; warehouseId: string },
  ) {
    const shopId = await this.shopId(data.ownerUserId);
    return this.warehouses.removeWarehouse(shopId, data.warehouseId);
  }

  @MessagePattern({ cmd: 'inventory.stock.list' })
  async listStock(
    @Payload() data: { ownerUserId: string; query: StockQueryDto },
  ) {
    const shopId = await this.shopId(data.ownerUserId);
    return this.stock.findAll(shopId, data.query);
  }

  @MessagePattern({ cmd: 'inventory.stock.low' })
  async lowStock(
    @Payload() data: { ownerUserId: string; query: StockQueryDto },
  ) {
    const shopId = await this.shopId(data.ownerUserId);
    return this.stock.findLow(shopId, data.query);
  }

  private async shopId(ownerUserId: string): Promise<string> {
    const shop = await sendRpc<SellerShop>(
      this.catalog,
      { cmd: 'seller.shop.get-me' },
      { ownerUserId },
    );
    return shop.id;
  }
}
