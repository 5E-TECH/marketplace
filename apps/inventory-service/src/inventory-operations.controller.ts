import {
  Controller,
  Inject,
  Logger,
  Optional,
  UseFilters,
} from '@nestjs/common';
import { ClientProxy, MessagePattern, Payload } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  CheckoutReserveInputDto,
  ReturnOrderItemsDto,
  RmqClient,
  RpcHttpExceptionFilter,
  STOCK_DEPLETED_EVENT,
  StockDepletedEvent,
} from '@app/common';
import { InventoryService } from './inventory.service';

/** Xabar yuborishni kutish chegarasi, ms — band qilish javobini ushlab turmasin [taklif]. */
const NOTIFY_TIMEOUT_MS = 1500;

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class InventoryOperationsController {
  private readonly logger = new Logger(InventoryOperationsController.name);

  constructor(
    private readonly inventory: InventoryService,
    // BE-47: «Offer qoldig‘i tugadi»
    @Optional()
    @Inject(RmqClient.NOTIFICATION)
    private readonly notifications?: ClientProxy,
  ) {}

  @MessagePattern({ cmd: 'inventory.reserve' })
  async reserve(@Payload() input: CheckoutReserveInputDto) {
    const result = await this.inventory.reserveAvailable(input);
    await this.notifyDepleted(
      (input?.items ?? []).map((item) => String(item.variantId)),
    );
    return result;
  }

  /** BE-47 TC4: band qilishdan keyin bo‘sh qoldig‘i 0 bo‘lgan variantlar — notification’ga (yuborilmasa — log). */
  private async notifyDepleted(variantIds: string[]): Promise<void> {
    if (!this.notifications || !variantIds.length) return;
    try {
      const available = await this.inventory.available(variantIds);
      const depleted = Object.entries(available)
        .filter(([, quantity]) => quantity <= 0)
        .map(([variantId]) => variantId);
      if (!depleted.length) return;
      const event: StockDepletedEvent = {
        variantIds: depleted,
        at: new Date().toISOString(),
      };
      await firstValueFrom(
        this.notifications
          .emit(STOCK_DEPLETED_EVENT, event)
          .pipe(timeout(NOTIFY_TIMEOUT_MS)),
        { defaultValue: undefined },
      );
    } catch (error) {
      this.logger.warn(
        `«Qoldiq tugadi» xabari yuborilmadi: ${(error as Error)?.message}`,
      );
    }
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

  @MessagePattern({ cmd: 'inventory.return-order-items' })
  returnOrderItems(@Payload() input: ReturnOrderItemsDto) {
    return this.inventory.returnOrderItems(input);
  }
}
