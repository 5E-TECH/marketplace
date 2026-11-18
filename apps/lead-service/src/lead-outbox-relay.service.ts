import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { LEAD_EVENTS, OutboxEvent, OutboxStatus, RmqClient } from '@app/common';

/**
 * lead-service outbox → RabbitMQ (T02:122: hodisa o‘z tranzaksiyasidagi outbox orqali; namuna
 * payment-outbox-relay.service.ts). `LEAD_OUTBOX_RELAY=on` bo‘lmaguncha yubormaydi: qabul qiluvchilar
 * (checkout — BE-18, eslatma — realtime/bildirishnoma) tayyor bo‘lguncha hodisalar PENDING da kutadi.
 */
@Injectable()
export class LeadOutboxRelayService {
  private readonly logger = new Logger(LeadOutboxRelayService.name);
  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outbox: Repository<OutboxEvent>,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.NOTIFICATION) private readonly notification: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'lead-outbox',
    waitForCompletion: true,
  })
  async relay(): Promise<number> {
    if (this.config.get<string>('LEAD_OUTBOX_RELAY') !== 'on') return 0;
    let sent = 0;
    try {
      await this.outbox.manager.transaction(async (manager) => {
        const repo = manager.getRepository(OutboxEvent);
        const rows = await repo
          .createQueryBuilder('event')
          .where('event.status = :status', { status: OutboxStatus.PENDING })
          // Faqat yo‘nalishi bor hodisalar: yuborilmaydigani navbat boshida turib qolib, qolganini to‘smasin (BE-35)
          .andWhere('event.eventType IN (:...types)', {
            types: Object.values(LEAD_EVENTS).filter((t) => this.route(t)),
          })
          .orderBy('event.id', 'ASC')
          .take(20)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getMany();
        for (const event of rows) {
          const client = this.route(event.eventType);
          if (!client) continue;
          try {
            await firstValueFrom(client.emit(event.eventType, event.payload));
          } catch {
            this.logger.warn(`Lead outbox qayta urinadi (id=${event.id})`);
            continue;
          }
          event.status = OutboxStatus.PROCESSED;
          event.processedAt = new Date();
          await repo.save(event);
          sent++;
        }
      });
    } catch {
      this.logger.warn(
        'Lead outbox yetkazilmadi; keyingi urinishda takrorlanadi',
      );
    }
    return sent;
  }

  private route(eventType: string): ClientProxy | null {
    if (eventType === LEAD_EVENTS.CONFIRMED) return this.checkout;
    if (eventType === LEAD_EVENTS.CALLBACK_REMINDER) return this.notification;
    // BE-35: sotuvchiga chora xabari. fraud.fee.* moliyaga — moliya iste’molchisi qo‘shilgach (BE-35 2-PR);
    // ungacha outbox da PENDING qoladi, yo‘qolmaydi.
    if (eventType === LEAD_EVENTS.FRAUD_MEASURE) return this.notification;
    return null;
  }
}
