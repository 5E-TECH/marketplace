import { Logger } from '@nestjs/common';
import {
  CustomStrategy,
  RmqContext,
  RmqOptions,
  ServerRMQ,
} from '@nestjs/microservices';
import { isObservable, lastValueFrom } from 'rxjs';
import {
  deadLetterQueue,
  RMQ_PREFETCH_COUNT,
  rmqQueueOptions,
} from './rmq.util';

/** amqplib xabari va kanalining bizga kerak qismi (Nest tiplari `any`). */
interface AmqpMessage {
  content: Buffer;
  properties: { replyTo?: string; correlationId?: string };
  fields: { redelivered: boolean; deliveryTag: number };
}
interface AmqpChannel {
  ack(message: AmqpMessage): void;
  nack(message: AmqpMessage, allUpTo?: boolean, requeue?: boolean): void;
  assertQueue(
    queue: string,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

/**
 * BE-02 (TZ T9-2): ishonchli RabbitMQ server — xabarlar qo‘lda tasdiqlanadi (manual ack), xato bo‘lsa yo‘qolmaydi.
 *
 * - **Hodisa** (`emit`/`@EventPattern`): handler muvaffaqiyatli tugagandan keyin `ack`. Xato bo‘lsa bir marta
 *   navbatga qaytariladi (darhol qayta urinish), ikkinchi xatoda — dead-letter → `<navbat>.dlq` (TC1).
 *   Handler topilmasa — DLQ.
 * - **So‘rov** (`send`/`@MessagePattern`): javob yuborilgandan keyin `ack` (xato javob ham javob — chaqiruvchi uni
 *   oldi). Servis javobdan oldin o‘lsa xabar tasdiqlanmagan qoladi va qayta yetkaziladi.
 * - Har xabar bir marta tasdiqlanadi (`ack`/`nack` ikki marta chaqirilsa kanal yopilardi).
 *
 * Eski `noAck: true` da hodisa yetib kelishi bilan o‘chirilardi: handler yiqilsa xabar yo‘qolardi (YOL-04).
 */
export class ReliableRmqServer extends ServerRMQ {
  private readonly reliableLogger = new Logger('ReliableRmqServer');
  private readonly settled = new WeakSet<object>();

  constructor(options: RmqOptions['options']) {
    super({ ...options, noAck: false });
  }

  /** Asosiy navbatdan oldin DLQ (dead-letter routing kaliti shu nomga). */
  async setupChannel(channel: AmqpChannel, callback: () => void) {
    await channel.assertQueue(deadLetterQueue(this.queue), { durable: true });
    return super.setupChannel(channel, callback);
  }

  async handleMessage(
    rawMessage: Record<string, any>,
    rawChannel: any,
  ): Promise<void> {
    const message = rawMessage as AmqpMessage | null;
    const channel = rawChannel as AmqpChannel;
    if (!message) return;
    let packet: { id?: string; pattern: unknown; data: unknown };
    let pattern: string;
    try {
      const raw = parseContent(message.content);
      packet = (await this.deserializer.deserialize(
        raw,
        message.properties,
      )) as typeof packet;
      pattern =
        typeof packet.pattern === 'string'
          ? packet.pattern
          : JSON.stringify(packet.pattern);
    } catch (error) {
      // O‘qib bo‘lmaydigan xabar — qayta urinish foyda bermaydi
      this.reliableLogger.error(
        `Xabar o‘qilmadi — DLQ ga: ${(error as Error).message}`,
      );
      this.settle(channel, message, 'dead');
      return;
    }
    const context = new RmqContext([message, channel, pattern]);
    if (packet.id === undefined)
      return this.handleReliableEvent(pattern, packet, context);

    const handler = this.getHandlerByPattern(pattern);
    if (!handler) {
      this.reliableLogger.warn(`So‘rov uchun handler yo‘q: ${pattern}`);
      this.sendMessage(
        {
          id: packet.id,
          err: `There is no matching message handler defined in the remote service.`,
          status: 'error',
        } as never,
        message.properties.replyTo!,
        message.properties.correlationId!,
        context,
      );
      this.settle(channel, message, 'dead');
      return;
    }
    return this.onProcessingStartHook(this.transportId, context, async () => {
      try {
        const response$ = this.transformToObservable(
          await handler(packet.data, context),
        );
        const publish = (data: { isDisposed?: boolean }) =>
          this.sendMessage(
            data as never,
            message.properties.replyTo!,
            message.properties.correlationId!,
            context,
          );
        if (response$) this.send(response$, publish as never);
        else this.settle(channel, message, 'ack');
      } catch (error) {
        // Handler sinxron xato tashladi (filtrdan oldin) — javob yo‘q; qayta yetkazilsin
        this.reliableLogger.error(
          `So‘rov handleri yiqildi (${pattern}): ${(error as Error).message}`,
        );
        this.settle(channel, message, 'retry');
      }
    });
  }

  /** Javob yuborilgach (oxirgi paket `isDisposed`) — so‘rov tasdiqlanadi. */
  sendMessage<T = any>(
    message: T,
    replyTo: any,
    correlationId: string,
    context: RmqContext,
  ): void {
    super.sendMessage(message, replyTo, correlationId, context);
    if ((message as { isDisposed?: boolean } | null)?.isDisposed)
      this.settle(
        context.getChannelRef() as AmqpChannel,
        context.getMessage() as AmqpMessage,
        'ack',
      );
  }

  private async handleReliableEvent(
    pattern: string,
    packet: { data: unknown },
    context: RmqContext,
  ) {
    const channel = context.getChannelRef() as AmqpChannel;
    const message = context.getMessage() as AmqpMessage;
    const handler = this.getHandlerByPattern(pattern);
    if (!handler) {
      this.reliableLogger.warn(
        `Hodisa uchun handler yo‘q — DLQ ga: ${pattern}`,
      );
      this.settle(channel, message, 'dead');
      return;
    }
    return this.onProcessingStartHook(this.transportId, context, async () => {
      try {
        const result = await handler(packet.data, context);
        // Exception filtri xatoni Observable ichida qaytaradi — oxirigacha kutiladi
        if (isObservable(result))
          await lastValueFrom(result, { defaultValue: undefined });
        this.settle(channel, message, 'ack');
      } catch (error) {
        const reason = (error as { message?: unknown })?.message ?? error;
        if (message.fields.redelivered) {
          this.reliableLogger.error(
            `Hodisa ikkinchi marta ham ishlanmadi — DLQ ga (${pattern}): ${String(reason)}`,
          );
          this.settle(channel, message, 'dead');
        } else {
          this.reliableLogger.warn(
            `Hodisa ishlanmadi — bir marta qayta (${pattern}): ${String(reason)}`,
          );
          this.settle(channel, message, 'retry');
        }
      } finally {
        this.onProcessingEndHook?.(this.transportId, context);
      }
    });
  }

  /** Bitta xabar — bitta tasdiq: ack, qayta navbatga yoki dead-letter (DLQ). */
  private settle(
    channel: AmqpChannel,
    message: AmqpMessage,
    outcome: 'ack' | 'retry' | 'dead',
  ): void {
    if (this.settled.has(message)) return;
    this.settled.add(message);
    if (outcome === 'ack') channel.ack(message);
    else channel.nack(message, false, outcome === 'retry');
  }
}

/** Nest `ServerRMQ.parseMessageContent` bilan bir xil: JSON bo‘lmasa — matn. */
function parseContent(content: Buffer): unknown {
  const text = content.toString();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Mikroservis serveri (har servis `main.ts`): qo‘lda tasdiq, DLQ, prefetch. */
export function rmqServer(urls: string[], queue: string): CustomStrategy {
  return {
    strategy: new ReliableRmqServer({
      urls,
      queue,
      queueOptions: rmqQueueOptions(queue),
      prefetchCount: RMQ_PREFETCH_COUNT,
      persistent: true,
    }),
  };
}
