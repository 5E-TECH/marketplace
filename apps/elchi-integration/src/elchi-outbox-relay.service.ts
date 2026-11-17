import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
 *
 * `ELCHI_OUTBOX_RELAY=on` bo'lgandagina ishlaydi: checkout da qabul qiluvchi
 * (BE-19) bo'lmaguncha hodisalar PENDING turadi — yuborilsa, RMQ ularni
 * egasiz tashlab yuborardi (lead-service dagi `LEAD_OUTBOX_RELAY` kabi).
 */
@Injectable()
export class ElchiOutboxRelayService {
  constructor(
    private readonly outbox: OutboxService,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'elchi-outbox-relay',
    waitForCompletion: true,
  })
  async relayPending(): Promise<number> {
    if (this.config.get<string>('ELCHI_OUTBOX_RELAY') !== 'on') return 0;
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
