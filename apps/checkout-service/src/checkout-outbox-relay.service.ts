import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { OutboxEvent, OutboxService, RmqClient } from '@app/common';

/**
 * BE-03: checkout outbox hodisalarini commit dan keyin yuboradi.
 * Bir nechta nusxada ham xavfsiz — relay qatorlarni SKIP LOCKED bilan oladi.
 */
@Injectable()
export class CheckoutOutboxRelayService {
  constructor(
    private readonly outbox: OutboxService,
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'checkout-outbox-relay',
    waitForCompletion: true,
  })
  relayPending(): Promise<number> {
    return this.outbox.relayPending((event) => this.publish(event));
  }

  private async publish(event: OutboxEvent): Promise<void> {
    if (!event.eventType.startsWith('finance.')) {
      // Noma'lum hodisa PENDING qoladi va logga tushadi — jim yo'qolmaydi.
      throw new Error(`Outbox: ${event.eventType} uchun qabul qiluvchi yo‘q`);
    }
    await firstValueFrom(this.finance.emit(event.eventType, event.payload), {
      defaultValue: undefined,
    });
  }
}
