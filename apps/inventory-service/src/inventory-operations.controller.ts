import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CheckoutReserveInputDto,
  ReturnOrderItemsDto,
  RpcHttpExceptionFilter,
  INVENTORY_STOCK_SUMMARY,
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

  @MessagePattern({ cmd: 'inventory.release' })
  release(
    @Payload()
    input: {
      orderRef: string;
      idempotencyKey: string;
      reason?: string;
      actorId?: string;
    },
  ) {
    return this.inventory.release(input);
  }

  /** BE-16: bo‘sh qoldiq HQ omborda — { variantIds } → { [variantId]: soni } (catalog offer, SOT-2). */
  @MessagePattern({ cmd: 'inventory.available' })
  available(@Payload() data: { variantIds: string[] }) {
    return this.inventory.available(data?.variantIds ?? []);
  }

  /** BE-25 (FE-12): admin mahsulotlar ro‘yxati — omborda, band, sotsa bo‘ladigan, yo‘lda (variant bo‘yicha). */
  @MessagePattern({ cmd: INVENTORY_STOCK_SUMMARY })
  stockSummary(@Payload() data: { variantIds: string[] }) {
    return this.inventory.stockSummary(data?.variantIds ?? []);
  }

  @MessagePattern({ cmd: 'inventory.return-order-items' })
  returnOrderItems(@Payload() input: ReturnOrderItemsDto) {
    return this.inventory.returnOrderItems(input);
  }
}
