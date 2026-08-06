import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CheckoutReserveInputDto, RpcHttpExceptionFilter } from '@app/common';
import { InventoryService } from './inventory.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class InventoryOperationsController {
  constructor(private readonly inventory: InventoryService) {}

  @MessagePattern({ cmd: 'inventory.reserve' })
  reserve(@Payload() input: CheckoutReserveInputDto) {
    return this.inventory.reserveAvailable(input);
  }
}
