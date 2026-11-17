import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OutboxEvent, OutboxStatus } from './outbox-event.entity';

/**
 * Qayta urinish foyda bermaydigan xato (masalan, hodisa turi uchun qabul
 * qiluvchi yo'q): relay hodisani FAILED qiladi, navbat boshini to'sib qo'ymaydi.
 */
export class OutboxPermanentError extends Error {}

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
 * Tartib: bir aggregate (masalan, bitta buyurtma) hodisalaridan faqat eng
 * eskisi olinadi — undan oldingisi PENDING tursa, keyingisi kutadi. Shunda
 * «to'lov» va «qaytarish» hodisalari o'rin almashmaydi (xato yoki ikkinchi
 * relay bo'lsa ham).
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
      const qb = repo.createQueryBuilder('event');
      const older = qb
        .subQuery()
        .select('1')
        .from(OutboxEvent, 'older')
        .where('older.aggregateType = event.aggregateType')
        .andWhere('older.aggregateId = event.aggregateId')
        .andWhere('older.status = :status')
        .andWhere('older.id < event.id')
        .getQuery();
      const pending = await qb
        .where('event.status = :status', { status: OutboxStatus.PENDING })
        .andWhere(`NOT EXISTS ${older}`)
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
          if (e instanceof OutboxPermanentError) {
            await repo.update(event.id, { status: OutboxStatus.FAILED });
          }
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
