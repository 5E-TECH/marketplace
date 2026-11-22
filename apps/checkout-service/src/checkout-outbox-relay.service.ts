import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  LEAD_EVENTS,
  ORDER_EVENTS,
  OutboxEvent,
  OutboxPermanentError,
  OutboxService,
  RmqClient,
} from '@app/common';

/** BE-18: outbox orqali yuboriladigan ombor buyruqlari (RPC, emit emas). */
const INVENTORY_COMMANDS = new Set(['inventory.release', 'inventory.commit']);

/** Broker uzilganda emit tugamaydi; relay tranzaksiyasi cheksiz ochiq qolmasin. */
const PUBLISH_TIMEOUT_MS = 5_000;

/**
 * BE-03: checkout outbox hodisalarini commit dan keyin yuboradi.
 * Bir nechta nusxada ham xavfsiz — relay qatorlarni SKIP LOCKED bilan oladi.
 *
 * BE-18: RMQ nuqtadan-nuqtaga — bitta hodisa har qabul qiluvchi navbatiga alohida yuboriladi:
 * - `order.status.changed` → moliya (BE-22), lid (BE-28, BE-31, BE-14), Elchi integratsiyasi (BE-20);
 *   bildirishnoma servisida hali qabul qiluvchi yo‘q (BE-24);
 * - `order.create-failed` → lid (BE-13).
 * Bittasi yiqilsa hodisa qayta yuboriladi — qabul qiluvchilar `eventId` bo‘yicha takrorni tashlaydi.
 */
@Injectable()
export class CheckoutOutboxRelayService {
  private readonly logger = new Logger(CheckoutOutboxRelayService.name);

  constructor(
    private readonly outbox: OutboxService,
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    // BE-24: mijozga buyurtma SMS lari (BUY-6) — notification-service ham `order.status.changed` ni oladi
    @Optional()
    @Inject(RmqClient.NOTIFICATION)
    private readonly notification?: ClientProxy,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'checkout-outbox-relay',
    waitForCompletion: true,
  })
  relayPending(): Promise<number> {
    return this.outbox.relayPending((event) => this.publish(event));
  }

  private async publish(event: OutboxEvent): Promise<void> {
    if (INVENTORY_COMMANDS.has(event.eventType))
      return this.inventoryCommand(event);
    const targets = this.targets(event.eventType);
    if (!targets.length) {
      // Noma'lum hodisa FAILED bo'ladi va logga tushadi: jim yo'qolmaydi va
      // navbatni to'sib qo'ymaydi.
      throw new OutboxPermanentError(
        `Outbox: ${event.eventType} uchun qabul qiluvchi yo‘q`,
      );
    }
    for (const client of targets)
      await firstValueFrom(
        client
          .emit(event.eventType, event.payload)
          .pipe(timeout(PUBLISH_TIMEOUT_MS)),
        { defaultValue: undefined },
      );
  }

  /**
   * BE-18: lid buyurtmasi holati bilan birga yozilgan ombor buyrug‘i (bekor — band bo‘shaydi, topshirish — chiqim).
   * Idempotent kalit bilan: oldin bajarilgan bo‘lsa ombor saqlangan javobni qaytaradi. Ombor 4xx (band yo‘q yoki
   * boshqa holatda) — qayta urinish foyda bermaydi: FAILED va logda (qo‘lda ko‘riladi).
   */
  private async inventoryCommand(event: OutboxEvent): Promise<void> {
    try {
      // qisqa kutish: ombor ishlamasa relay tranzaksiyasi boshqa hodisalarni uzoq ushlab turmasin
      await firstValueFrom(
        this.inventory
          .send({ cmd: event.eventType }, event.payload)
          .pipe(timeout(PUBLISH_TIMEOUT_MS)),
      );
    } catch (error) {
      const e = error as {
        statusCode?: unknown;
        status?: unknown;
        message?: unknown;
      };
      const raw = e?.statusCode ?? e?.status;
      const status = typeof raw === 'number' ? raw : 500;
      const message = String(e?.message ?? error);
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        this.logger.error(
          `Ombor buyrug‘i bajarilmadi (${event.eventType}, buyurtma ${event.aggregateId}): ${message}`,
        );
        throw new OutboxPermanentError(`${event.eventType}: ${message}`);
      }
      throw error;
    }
  }

  private targets(eventType: string): ClientProxy[] {
    if (eventType.startsWith('finance.')) return [this.finance];
    if (eventType === ORDER_EVENTS.STATUS_CHANGED)
      return [
        this.finance,
        this.lead,
        this.integration,
        ...(this.notification ? [this.notification] : []),
      ];
    if (eventType === LEAD_EVENTS.ORDER_CREATE_FAILED) return [this.lead];
    // BE-44: yetkazilgandan keyin qaytarish — moliya teskari yozuvlari (BE-22)
    if (eventType === ORDER_EVENTS.RETURNED) return [this.finance];
    return [];
  }
}
