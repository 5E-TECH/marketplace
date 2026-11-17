import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OutboxEvent, OutboxStatus } from './outbox-event.entity';

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
}

/**
 * Outbox pattern (BE-03, TZ T9-3).
 *  - record(): hodisani PENDING holatda saqlaydi. `manager` berilsa — biznes
 *    tranzaksiyasi ichida: rollback bo'lsa hodisa ham yo'qoladi va yuborilmaydi.
 *  - relayPending(): PENDING larni `FOR UPDATE SKIP LOCKED` bilan oladi,
 *    yuboradi va PROCESSED belgilaydi — o'sha tranzaksiyada. Ikkinchi relay
 *    nusxasi qulflangan qatorlarni o'tkazib yuboradi, shuning uchun bir hodisa
 *    ikki relay tomonidan bir vaqtda yuborilmaydi.
 *
 * Kafolat «kamida bir marta»: yuborilgandan keyin commit muvaffaqiyatsiz
 * bo'lsa, hodisa keyingi urinishda qayta ketadi. Iste'molchilar `eventId`
 * bo'yicha idempotent bo'lishi kerak (`processOnce`).
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repo: Repository<OutboxEvent>,
  ) {}

  record(
    event: OutboxEventInput,
    manager?: EntityManager,
  ): Promise<OutboxEvent> {
    const repo = manager ? manager.getRepository(OutboxEvent) : this.repo;
    return repo.save(repo.create({ ...event, status: OutboxStatus.PENDING }));
  }

  /** PENDING hodisalarni yuboradi. Yuborilgan hodisa soni qaytadi. */
  relayPending(
    publish: (event: OutboxEvent) => Promise<void>,
    batchSize = 100,
  ): Promise<number> {
    return this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(OutboxEvent);
      const pending = await repo
        .createQueryBuilder('event')
        .where('event.status = :status', { status: OutboxStatus.PENDING })
        .orderBy('event.id', 'ASC')
        .take(batchSize)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      let sent = 0;
      for (const event of pending) {
        try {
          await publish(event);
        } catch (e) {
          this.logger.error(
            `Outbox publish xatosi (id=${event.id}): ${(e as Error).message}`,
          );
          continue;
        }
        await repo.update(event.id, {
          status: OutboxStatus.PROCESSED,
          processedAt: new Date(),
        });
        sent++;
      }
      return sent;
    });
  }
}
