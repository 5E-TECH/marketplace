import { Inject, Injectable, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { OutboxEvent, OutboxService, RmqClient } from '@app/common';
import { NOTIFICATION_EVENTS } from './inventory.helpers';

@Injectable()
export class InventoryOutboxRelayService {
  constructor(
    private readonly outboxService: OutboxService,
    @Inject(RmqClient.CATALOG)
    private readonly catalogClient: ClientProxy,
    // BE-47: «qoldiq tugadi», «postavka qabul qilindi» — notification-service ga
    @Optional()
    @Inject(RmqClient.NOTIFICATION)
    private readonly notificationClient?: ClientProxy,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'inventory-outbox-relay',
    waitForCompletion: true,
  })
  relayPending(): Promise<number> {
    return this.outboxService.relayPending((event) => this.publish(event));
  }

  private async publish(event: OutboxEvent): Promise<void> {
    if (NOTIFICATION_EVENTS.has(event.eventType)) {
      // klient yo‘q bo‘lsa — xato: hodisa PENDING da qoladi (yo‘qolmaydi)
      if (!this.notificationClient)
        throw new Error('notification klienti sozlanmagan');
      await firstValueFrom(
        this.notificationClient.emit(event.eventType, event.payload),
      );
      return;
    }
    await firstValueFrom(
      this.catalogClient.emit(event.eventType, event.payload),
    );
  }
}
