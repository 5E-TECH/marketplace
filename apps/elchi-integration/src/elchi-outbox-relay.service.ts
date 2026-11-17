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

const PUBLISH_TIMEOUT_MS = 5_000;

/**
 * BE-20: `elchi.parcel.*` hodisalarini commit dan keyin checkout ga yuboradi
 * (BE-03 relay: SKIP LOCKED, aggregate tartibi).
 */
@Injectable()
export class ElchiOutboxRelayService {
  constructor(
    private readonly outbox: OutboxService,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'elchi-outbox-relay',
    waitForCompletion: true,
  })
  relayPending(): Promise<number> {
    return this.outbox.relayPending((event) => this.publish(event));
  }

  private async publish(event: OutboxEvent): Promise<void> {
    if (!event.eventType.startsWith('elchi.parcel.')) {
      throw new OutboxPermanentError(
        `Outbox: ${event.eventType} uchun qabul qiluvchi yo‘q`,
      );
    }
    await firstValueFrom(
      this.checkout
        .emit(event.eventType, event.payload)
        .pipe(timeout(PUBLISH_TIMEOUT_MS)),
      { defaultValue: undefined },
    );
  }
}
