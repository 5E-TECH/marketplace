import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AdminStockMovementsQueryDto,
  AdminStockQueryDto,
  RpcHttpExceptionFilter,
} from '@app/common';
import { AdminInventoryQueryService } from './admin-inventory-query.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class AdminInventoryController {
  constructor(private readonly queries: AdminInventoryQueryService) {}

  @MessagePattern({ cmd: 'inventory.admin.stock-list' })
  stock(@Payload() data: { query: AdminStockQueryDto }) {
    return this.queries.stock(data.query);
  }

  @MessagePattern({ cmd: 'inventory.admin.movements-list' })
  movements(@Payload() data: { query: AdminStockMovementsQueryDto }) {
    return this.queries.movementList(data.query);
  }
}
