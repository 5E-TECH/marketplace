import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OutboxEvent, OutboxStatus } from './outbox-event.entity';

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
}

/**
 * Outbox pattern.
 *  - record(): event'ni PENDING holatda saqlaydi (biznes tx ichida chaqiriladi).
 *  - relayPending(): PENDING'larni publish qiladi va PROCESSED belgilaydi.
 * Bir marta yuborilishi PROCESSED holatda qayta olinmasligi bilan kafolatlanadi.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repo: Repository<OutboxEvent>,
  ) {}

  record(event: OutboxEventInput): Promise<OutboxEvent> {
    return this.repo.save(
      this.repo.create({ ...event, status: OutboxStatus.PENDING }),
    );
  }

  /** PENDING event'larni publish qiladi. Yuborilgan event soni qaytadi. */
  async relayPending(
    publish: (event: OutboxEvent) => Promise<void>,
    batchSize = 100,
  ): Promise<number> {
    const pending = await this.repo.find({
      where: { status: OutboxStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: batchSize,
    });

    let sent = 0;
    for (const event of pending) {
      try {
        await publish(event);
        event.status = OutboxStatus.PROCESSED;
        event.processedAt = new Date();
        await this.repo.save(event);
        sent++;
      } catch (e) {
        this.logger.error(
          `Outbox publish xatosi (id=${event.id}): ${(e as Error).message}`,
        );
      }
    }
    return sent;
  }
}
