import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CheckoutReserveInputDto,
  ReturnOrderItemsDto,
  RpcHttpExceptionFilter,
} from '@app/common';
import { InventoryService } from './inventory.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class InventoryOperationsController {
  constructor(private readonly inventory: InventoryService) {}

  @MessagePattern({ cmd: 'inventory.reserve' })
  reserve(@Payload() input: CheckoutReserveInputDto) {
    return this.inventory.reserveAvailable(input);
  }

  @MessagePattern({ cmd: 'inventory.commit' })
  commit(
    @Payload()
    input: {
      orderRef: string;
      idempotencyKey: string;
      actorId?: string;
    },
  ) {
    return this.inventory.commit(input);
  }

  @MessagePattern({ cmd: 'inventory.return-order-items' })
  returnOrderItems(@Payload() input: ReturnOrderItemsDto) {
    return this.inventory.returnOrderItems(input);
  }
}
