import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxEvent, OutboxStatus, PaymentStatus } from '@app/common';
import { Repository } from 'typeorm';
import { PaymentEventsService } from './payment-events.service';
import { Payment } from './entities/payment.entity';

@Injectable()
export class PaymentOutboxRelayService {
  private readonly logger = new Logger(PaymentOutboxRelayService.name);
  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outbox: Repository<OutboxEvent>,
    private readonly events: PaymentEventsService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'payment-outbox',
    waitForCompletion: true,
  })
  async relay(): Promise<void> {
    try {
      await this.outbox.manager.transaction(async (manager) => {
        const repo = manager.getRepository(OutboxEvent);
        const rows = await repo
          .createQueryBuilder('event')
          .where('event.status = :status', { status: OutboxStatus.PENDING })
          .orderBy('event.id', 'ASC')
          .take(20)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getMany();
        for (const event of rows) {
          const payment = await manager
            .getRepository(Payment)
            .findOneByOrFail({ id: event.aggregateId });
          if (payment.status !== PaymentStatus.PAID) {
            // A cancellation/refund superseded this pending paid notification.
            event.status = OutboxStatus.FAILED;
            await repo.save(event);
            continue;
          }
          try {
            await this.events.publish(event);
          } catch {
            this.logger.warn(`Payment outbox retry pending (id=${event.id})`);
            continue;
          }
          event.status = OutboxStatus.PROCESSED;
          event.processedAt = new Date();
          await repo.save(event);
        }
      });
    } catch {
      this.logger.warn(
        'Payment outbox yetkazilmadi; keyingi urinishda takrorlanadi',
      );
    }
  }
}
