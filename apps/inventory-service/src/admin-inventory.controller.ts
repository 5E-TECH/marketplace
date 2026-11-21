import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AdminStockMovementsQueryDto,
  AdminStockQueryDto,
  RpcHttpExceptionFilter,
} from '@app/common';
import { AdminInventoryQueryService } from './admin-inventory-query.service';
import { InventoryService } from './inventory.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class AdminInventoryController {
  constructor(
    private readonly queries: AdminInventoryQueryService,
    private readonly operations: InventoryService,
  ) {}

  /** BE-16: HQ omborga kirim (omborchi); to‘liq qabul akti — BE-17. */
  @MessagePattern({ cmd: 'inventory.hq.inbound' })
  async hqInbound(
    @Payload()
    data: {
      variantId: string;
      quantity: number;
      reason: string;
      actorId: string;
      idempotencyKey: string;
    },
  ) {
    return this.operations.inbound({
      ...data,
      warehouseId: await this.operations.hqWarehouseId(),
    });
  }

  /** BE-16: HQ qoldig‘ini tuzatish (inventarizatsiya). */
  @MessagePattern({ cmd: 'inventory.hq.adjust' })
  async hqAdjust(
    @Payload()
    data: {
      variantId: string;
      delta: number;
      reason: string;
      actorId: string;
      idempotencyKey: string;
      lotId?: string;
      goodStock?: boolean;
    },
  ) {
    return this.operations.adjust({
      lotId: data.lotId,
      goodStock: data.goodStock === true,
      variantId: data.variantId,
      warehouseId: await this.operations.hqWarehouseId(),
      quantityDelta: data.delta,
      reason: data.reason,
      actorId: data.actorId,
      idempotencyKey: data.idempotencyKey,
    });
  }

  @MessagePattern({ cmd: 'inventory.admin.stock-list' })
  stock(@Payload() data: { query: AdminStockQueryDto }) {
    return this.queries.stock(data.query);
  }

  @MessagePattern({ cmd: 'inventory.admin.movements-list' })
  movements(@Payload() data: { query: AdminStockMovementsQueryDto }) {
    return this.queries.movementList(data.query);
  }
}
