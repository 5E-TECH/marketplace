import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  OutboxEvent,
  OutboxPermanentError,
  OutboxService,
  RmqClient,
} from '@app/common';

/** Broker uzilganda emit tugamaydi; relay tranzaksiyasi cheksiz ochiq qolmasin. */
const PUBLISH_TIMEOUT_MS = 5_000;

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
      // Noma'lum hodisa FAILED bo'ladi va logga tushadi: jim yo'qolmaydi va
      // navbatni to'sib qo'ymaydi.
      throw new OutboxPermanentError(
        `Outbox: ${event.eventType} uchun qabul qiluvchi yo‘q`,
      );
    }
    await firstValueFrom(
      this.finance
        .emit(event.eventType, event.payload)
        .pipe(timeout(PUBLISH_TIMEOUT_MS)),
      { defaultValue: undefined },
    );
  }
}
