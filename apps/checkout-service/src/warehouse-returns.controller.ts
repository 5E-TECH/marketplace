import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RpcHttpExceptionFilter, WAREHOUSE_RPC } from '@app/common';
import { WarehouseReturnsService } from './warehouse-returns.service';

/** BE-17: qaytgan posilkalar (gateway `warehouse/returns`). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class WarehouseReturnsController {
  constructor(private readonly returns: WarehouseReturnsService) {}

  @MessagePattern({ cmd: WAREHOUSE_RPC.RETURNS })
  list() {
    return this.returns.list();
  }

  @MessagePattern({ cmd: WAREHOUSE_RPC.RETURN_INFO })
  info(@Payload() data: { orderId: string }) {
    return this.returns.info(data);
  }
}
