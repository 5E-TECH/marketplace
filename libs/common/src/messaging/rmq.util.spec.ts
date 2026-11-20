import { ReliableRmqServer, rmqServer } from './reliable-rmq.server';
import {
  deadLetterQueue,
  RMQ_PREFETCH_COUNT,
  RmqQueue,
  rmqOptions,
  rmqQueueOptions,
} from './rmq.util';

describe('RabbitMQ sozlamalari (BE-02, TZ T9-2)', () => {
  it('client: doimiy xabar, doimiy navbat, rad etilgan xabar <navbat>.dlq ga', () => {
    const options = rmqOptions(['amqp://x'], 'checkout_queue_v2').options!;
    expect(options).toMatchObject({
      queue: 'checkout_queue_v2',
      persistent: true,
      queueOptions: {
        durable: true,
        deadLetterExchange: '',
        deadLetterRoutingKey: 'checkout_queue_v2.dlq',
      },
    });
    // RPC javobi direct reply-to orqali — client noAck sukutda qoladi
    expect(options).not.toHaveProperty('noAck');
  });

  it('server: qo‘lda tasdiq, prefetch, client bilan bir xil navbat argumentlari', () => {
    const { strategy } = rmqServer(['amqp://x'], 'lead_queue_v2');
    expect(strategy).toBeInstanceOf(ReliableRmqServer);
    const server = strategy as unknown as {
      noAck: boolean;
      queue: string;
      queueOptions: unknown;
      options: { prefetchCount: number; persistent: boolean };
    };
    expect(server.noAck).toBe(false);
    expect(server.queue).toBe('lead_queue_v2');
    expect(server.queueOptions).toEqual(rmqQueueOptions('lead_queue_v2'));
    expect(server.options).toMatchObject({
      prefetchCount: RMQ_PREFETCH_COUNT,
      persistent: true,
    });
  });

  it('hamma navbat `_v2` (DLX argumentlari bilan yangi navbat) va DLQ nomi', () => {
    for (const queue of Object.values(RmqQueue))
      expect(queue).toMatch(/^[a-z]+_queue_v2$/);
    expect(deadLetterQueue('file_queue_v2')).toBe('file_queue_v2.dlq');
  });
});
