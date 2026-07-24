import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { OutboxEvent, OutboxService, RmqClient } from '@app/common';

@Injectable()
export class InventoryOutboxRelayService {
  constructor(
    private readonly outboxService: OutboxService,
    @Inject(RmqClient.CATALOG)
    private readonly catalogClient: ClientProxy,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'inventory-outbox-relay',
    waitForCompletion: true,
  })
  relayPending(): Promise<number> {
    return this.outboxService.relayPending((event) => this.publish(event));
  }

  private async publish(event: OutboxEvent): Promise<void> {
    await firstValueFrom(
      this.catalogClient.emit(event.eventType, event.payload),
    );
  }
}
