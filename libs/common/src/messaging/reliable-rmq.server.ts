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
  rmqDeadLetterQueueOptions,
  rmqQueueOptions,
  rmqRetryQueueOptions,
  retryQueue,
} from './rmq.util';

/** amqplib xabari va kanalining bizga kerak qismi (Nest tiplari `any`). */
interface AmqpMessage {
  content: Buffer;
  properties: {
    replyTo?: string;
    correlationId?: string;
    headers?: Record<string, unknown>;
    [key: string]: unknown;
  };
  fields: { redelivered: boolean; deliveryTag: number };
}
interface AmqpChannel {
  ack(message: AmqpMessage): void;
  nack(message: AmqpMessage, allUpTo?: boolean, requeue?: boolean): void;
  assertQueue(
    queue: string,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  sendToQueue(
    queue: string,
    content: Buffer,
    options?: Record<string, unknown>,
  ): boolean;
}

/** Xabar necha marta ishlanganini o‘zimiz sanaymiz (`redelivered` iste’molchi o‘lganda ham true bo‘ladi). */
export const RMQ_ATTEMPT_HEADER = 'x-elchi-attempt';

export interface ReliableRmqOptions {
  /** Hodisani necha marta ishlashga urinish (birinchisi bilan); keyin — DLQ. Bildirishnomalar uchun 1. */
  maxAttempts?: number;
  /** Qayta urinishlar orasidagi kutish, ms (`<navbat>.retry` TTL). */
  retryDelayMs?: number;
}

/** Sukut: 3 urinish, 10 s oraliq [taklif] — qisqa uzilishda (baza, tarmoq) hodisa DLQ ga tushmasin. */
export const RMQ_DEFAULT_MAX_ATTEMPTS = 3;
export const RMQ_DEFAULT_RETRY_DELAY_MS = 10_000;

/**
 * BE-02 (TZ T9-2): ishonchli RabbitMQ server — xabarlar qo‘lda tasdiqlanadi (manual ack), xato bo‘lsa yo‘qolmaydi.
 *
 * - **Hodisa** (`emit`/`@EventPattern`): handler muvaffaqiyatli tugagach `ack`. Xato bo‘lsa nusxa `<navbat>.retry`
 *   ga (TTL tugagach asosiy navbatga qaytadi) va urinish sanog‘i oshadi; `maxAttempts` dan keyin — dead-letter →
 *   `<navbat>.dlq` (TC1). Sanoq sarlavhada: iste’molchi o‘lib qayta yetkazilgan xabar urinish hisoblanmaydi.
 * - **Handleri yo‘q hodisa** — avvalgidek logda va tasdiqlanadi (DLQ ga emas): ba’zi hodisalarning qabul qiluvchisi
 *   keyingi kartalarda (masalan, bildirishnomalar BE-24); ularni DLQ da saqlash ma’nosiz (OTP kabi ma’lumot ham).
 * - **So‘rov** (`send`/`@MessagePattern`): javob yuborilgach `ack` (xato javob ham javob).
 * - Har xabar bir marta tasdiqlanadi; kanal yopilgan bo‘lsa tasdiq xatosi ushlanadi — broker xabarni o‘zi qayta
 *   yetkazadi (jarayon yiqilmaydi).
 */
export class ReliableRmqServer extends ServerRMQ {
  private readonly reliableLogger = new Logger('ReliableRmqServer');
  private readonly settled = new WeakSet<object>();
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    options: RmqOptions['options'],
    reliable: ReliableRmqOptions = {},
  ) {
    super({ ...options, noAck: false });
    this.maxAttempts = Math.max(
      1,
      reliable.maxAttempts ?? RMQ_DEFAULT_MAX_ATTEMPTS,
    );
    this.retryDelayMs = Math.max(
      1,
      reliable.retryDelayMs ?? RMQ_DEFAULT_RETRY_DELAY_MS,
    );
  }

  /** Asosiy navbatdan oldin DLQ va qayta urinish navbati. */
  async setupChannel(channel: AmqpChannel, callback: () => void) {
    await channel.assertQueue(
      deadLetterQueue(this.queue),
      rmqDeadLetterQueueOptions(),
    );
    await channel.assertQueue(
      retryQueue(this.queue),
      rmqRetryQueueOptions(this.queue, this.retryDelayMs),
    );
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
      // chaqiruvchi xato javob oladi; xabar tasdiqlanadi (javob — yakun)
      this.sendMessage(
        {
          id: packet.id,
          err: 'There is no matching message handler defined in the remote service.',
          status: 'error',
          isDisposed: true,
        },
        message.properties.replyTo,
        message.properties.correlationId!,
        context,
      );
      return;
    }
    return this.onProcessingStartHook(this.transportId, context, async () => {
      try {
        const response$ = this.transformToObservable(
          await handler(packet.data, context),
        );
        const publish = (data: unknown) =>
          this.sendMessage(
            data,
            message.properties.replyTo,
            message.properties.correlationId!,
            context,
          );
        if (response$) this.send(response$, publish as never);
        else this.settle(channel, message, 'ack');
      } catch (error) {
        // Handler filtrdan oldin sinxron yiqildi — javob yo‘q; DLQ (cheksiz qayta navbat emas)
        this.reliableLogger.error(
          `So‘rov handleri yiqildi — DLQ ga (${pattern}): ${(error as Error).message}`,
        );
        this.settle(channel, message, 'dead');
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
    try {
      super.sendMessage(message, replyTo, correlationId, context);
    } catch (error) {
      this.reliableLogger.warn(
        `Javob yuborilmadi: ${(error as Error).message}`,
      );
    }
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
        `Hodisa uchun handler yo‘q — tashlab yuborildi: ${pattern}`,
      );
      this.settle(channel, message, 'ack');
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
        this.retryOrDeadLetter(pattern, channel, message, error);
      } finally {
        this.onProcessingEndHook?.(this.transportId, context);
      }
    });
  }

  /** Urinishlar tugamagan bo‘lsa — kechiktirilgan qayta urinish; tugagan bo‘lsa — DLQ. */
  private retryOrDeadLetter(
    pattern: string,
    channel: AmqpChannel,
    message: AmqpMessage,
    error: unknown,
  ): void {
    const reason = String((error as { message?: unknown })?.message ?? error);
    const attempt = attemptOf(message) + 1;
    if (attempt >= this.maxAttempts) {
      this.reliableLogger.error(
        `Hodisa ${attempt}-urinishda ham ishlanmadi — DLQ ga (${pattern}): ${reason}`,
      );
      this.settle(channel, message, 'dead');
      return;
    }
    if (this.settled.has(message)) return;
    try {
      channel.sendToQueue(retryQueue(this.queue), message.content, {
        ...message.properties,
        persistent: true,
        headers: {
          ...(message.properties.headers ?? {}),
          [RMQ_ATTEMPT_HEADER]: attempt,
        },
      });
    } catch (publishError) {
      // Nusxa yuborilmadi — asl xabar qayta navbatga (yo‘qolmasin)
      this.reliableLogger.warn(
        `Qayta urinish nusxasi yuborilmadi (${pattern}): ${(publishError as Error).message}`,
      );
      this.settle(channel, message, 'requeue');
      return;
    }
    this.reliableLogger.warn(
      `Hodisa ishlanmadi — ${this.retryDelayMs} ms dan keyin ${attempt + 1}-urinish (${pattern}): ${reason}`,
    );
    this.settle(channel, message, 'ack');
  }

  /** Bitta xabar — bitta tasdiq. Kanal yopilgan bo‘lsa xato ushlanadi: broker xabarni o‘zi qayta yetkazadi. */
  private settle(
    channel: AmqpChannel,
    message: AmqpMessage,
    outcome: 'ack' | 'requeue' | 'dead',
  ): void {
    if (this.settled.has(message)) return;
    this.settled.add(message);
    try {
      if (outcome === 'ack') channel.ack(message);
      else channel.nack(message, false, outcome === 'requeue');
    } catch (error) {
      this.reliableLogger.warn(
        `Xabar tasdiqlanmadi (kanal yopilgan, broker qayta yetkazadi): ${(error as Error).message}`,
      );
    }
  }
}

function attemptOf(message: AmqpMessage): number {
  const value = Number(message.properties.headers?.[RMQ_ATTEMPT_HEADER] ?? 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
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

/** Mikroservis serveri (har servis `main.ts`): qo‘lda tasdiq, kechiktirilgan qayta urinish, DLQ, prefetch. */
export function rmqServer(
  urls: string[],
  queue: string,
  reliable: ReliableRmqOptions = {},
): CustomStrategy {
  return {
    strategy: new ReliableRmqServer(
      {
        urls,
        queue,
        queueOptions: rmqQueueOptions(queue),
        prefetchCount: RMQ_PREFETCH_COUNT,
        persistent: true,
      },
      reliable,
    ),
  };
}
