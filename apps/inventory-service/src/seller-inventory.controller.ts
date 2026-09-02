import { Controller, Inject, UseFilters } from '@nestjs/common';
import { ClientProxy, MessagePattern, Payload } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import {
  CreateWarehouseDto,
  RmqClient,
  RpcHttpExceptionFilter,
  sendRpc,
  StockQueryDto,
  StockAdjustDto,
  StockInboundDto,
  UpdateWarehouseDto,
} from '@app/common';
import { InventoryService } from './inventory.service';
import { InventoryResult } from './inventory.types';
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
    private readonly inventory: InventoryService,
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

  /** Admin approve: shop uchun default ombor (shopId bo'yicha, idempotent). */
  @MessagePattern({ cmd: 'inventory.warehouse.ensure-default' })
  ensureDefaultWarehouse(
    @Payload()
    data: {
      shopId: string;
      name?: string;
      regionId?: string | null;
      districtId?: string | null;
    },
  ) {
    return this.warehouses.ensureDefaultWarehouse(
      String(data.shopId),
      data.name,
      data.regionId,
      data.districtId,
    );
  }

  @MessagePattern({ cmd: 'inventory.warehouse.count-by-shop' })
  countWarehouses(@Payload() data: { shopId: string }) {
    return this.warehouses.countByShop(String(data.shopId));
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

  @MessagePattern({ cmd: 'inventory.stock.inbound' })
  async inbound(
    @Payload() data: { ownerUserId: string; dto: StockInboundDto },
  ) {
    const shopId = await this.shopId(data.ownerUserId);
    await this.warehouses.assertOwned(shopId, data.dto.warehouseId);
    const result = await this.inventory.inbound({
      variantId: data.dto.variantId,
      warehouseId: data.dto.warehouseId,
      quantity: data.dto.quantity,
      reason: data.dto.reason,
      actorId: data.ownerUserId,
      idempotencyKey: data.dto.idempotencyKey ?? randomUUID(),
    });
    return this.stockMutationResult(data.dto, result);
  }

  @MessagePattern({ cmd: 'inventory.stock.adjust' })
  async adjust(@Payload() data: { ownerUserId: string; dto: StockAdjustDto }) {
    const shopId = await this.shopId(data.ownerUserId);
    await this.warehouses.assertOwned(shopId, data.dto.warehouseId);
    const result = await this.inventory.adjust({
      variantId: data.dto.variantId,
      warehouseId: data.dto.warehouseId,
      quantityDelta: data.dto.delta,
      reason: data.dto.reason,
      actorId: data.ownerUserId,
      idempotencyKey: data.dto.idempotencyKey ?? randomUUID(),
    });
    return this.stockMutationResult(data.dto, result);
  }

  private async shopId(ownerUserId: string): Promise<string> {
    const shop = await sendRpc<SellerShop>(
      this.catalog,
      { cmd: 'seller.shop.get-me' },
      { ownerUserId },
    );
    return shop.id;
  }

  private stockMutationResult(
    target: { variantId: string; warehouseId: string },
    result: InventoryResult,
  ) {
    return {
      variantId: target.variantId,
      warehouseId: target.warehouseId,
      onHand: result.onHand,
      reserved: result.reserved,
      available: result.onHand! - result.reserved!,
    };
  }
}
