import {
  BadRequestException,
  Controller,
  INestMicroservice,
  Module,
  UseFilters,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  ClientProxy,
  ClientProxyFactory,
  EventPattern,
  MessagePattern,
  Payload,
} from '@nestjs/microservices';
import * as amqp from 'amqplib';
import { firstValueFrom } from 'rxjs';
import { RpcHttpExceptionFilter } from '../filters/rpc-http-exception.filter';
import { rmqServer } from './reliable-rmq.server';
import { deadLetterQueue, retryQueue, rmqOptions } from './rmq.util';

const url = process.env.TEST_RABBITMQ_URL;
const describeWithRabbit = url ? describe : describe.skip;

const calls: Record<string, number> = {};
const count = (name: string) => (calls[name] = (calls[name] ?? 0) + 1);

@Controller()
@UseFilters(RpcHttpExceptionFilter)
class ProbeController {
  @EventPattern('probe.ok')
  ok() {
    count('ok');
  }

  @EventPattern('probe.fail')
  async fail() {
    count('fail');
    throw new BadRequestException('handler yiqildi');
  }

  @MessagePattern({ cmd: 'probe.echo' })
  echo(@Payload() data: { text: string }) {
    return { echoed: data.text };
  }

  @MessagePattern({ cmd: 'probe.boom' })
  boom() {
    count('boom');
    throw new BadRequestException('yomon so‘rov');
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

/**
 * BE-02 haqiqiy RabbitMQ da (`TEST_RABBITMQ_URL`): hodisa xatosi — DLQ (TC1), muvaffaqiyat — bir marta ack (TC3),
 * xabarlar doimiy (TC2 asosi: `deliveryMode` 2, navbat doimiy), so‘rov javobidan keyin ack.
 */
describeWithRabbit('BE-02 ishonchli RabbitMQ (haqiqiy broker)', () => {
  const queue = `be02_probe_${Date.now()}`;
  const dlq = deadLetterQueue(queue);
  let app: INestMicroservice;
  let client: ClientProxy;
  let connection: amqp.ChannelModel;
  let channel: amqp.Channel;

  const waitFor = async (check: () => Promise<boolean> | boolean) => {
    const until = Date.now() + 8_000;
    while (Date.now() < until) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('kutilgan holat 8 s ichida bo‘lmadi');
  };
  const ready = async (name: string) =>
    (await channel.checkQueue(name)).messageCount;

  beforeAll(async () => {
    app = await NestFactory.createMicroservice(ProbeModule, {
      ...rmqServer([url!], queue, { retryDelayMs: 200 }),
      logger: false,
    });
    await app.listen();
    client = ClientProxyFactory.create(rmqOptions([url!], queue));
    await client.connect();
    connection = await amqp.connect(url!);
    channel = await connection.createChannel();
  });

  afterAll(async () => {
    await client?.close();
    await app?.close();
    if (channel) {
      await channel.deleteQueue(queue).catch(() => undefined);
      await channel.deleteQueue(dlq).catch(() => undefined);
      await channel.deleteQueue(retryQueue(queue)).catch(() => undefined);
      await channel.close().catch(() => undefined);
    }
    await connection?.close().catch(() => undefined);
  });

  it('navbat doimiy va DLQ argumentlari bilan; DLQ yaratilgan', async () => {
    // passiv tekshiruv: argumentlar boshqacha bo‘lsa assertQueue PRECONDITION_FAILED berardi
    const other = await connection.createChannel();
    await expect(
      other.assertQueue(queue, {
        durable: true,
        deadLetterExchange: '',
        deadLetterRoutingKey: dlq,
      }),
    ).resolves.toMatchObject({ queue });
    await other.close();
    await expect(channel.checkQueue(dlq)).resolves.toMatchObject({
      queue: dlq,
    });
  });

  it('TC3: handler muvaffaqiyatli — ack, xabar ikki marta ishlanmaydi', async () => {
    await firstValueFrom(client.emit('probe.ok', { n: 1 }), {
      defaultValue: undefined,
    });
    await waitFor(() => calls.ok === 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls.ok).toBe(1);
    expect(await ready(queue)).toBe(0);
  });

  it('TC1: handler xato tashlaydi — kechiktirib 3 marta urinadi, keyin DLQ da (navbatdan yo‘qolmaydi)', async () => {
    await firstValueFrom(client.emit('probe.fail', { orderId: '7' }), {
      defaultValue: undefined,
    });
    await waitFor(async () => (await ready(dlq)) === 1);
    expect(await ready(retryQueue(queue))).toBe(0);
    expect(calls.fail).toBe(3);
    expect(await ready(queue)).toBe(0);

    const dead = await channel.get(dlq, { noAck: false });
    expect(dead).not.toBe(false);
    const message = dead as amqp.GetMessage;
    // TC2 asosi: xabar doimiy (persistent) — broker qayta ishga tushsa saqlanadi
    expect(message.properties.deliveryMode).toBe(2);
    expect(JSON.parse(message.content.toString())).toMatchObject({
      pattern: 'probe.fail',
      data: { orderId: '7' },
    });
    expect(message.properties.headers?.['x-elchi-attempt']).toBe(2);
    expect(message.properties.headers?.['x-death']?.[0]).toMatchObject({
      queue,
      reason: 'rejected',
    });
    channel.nack(message, false, true); // DLQ da qolsin
  });

  it('handleri yo‘q hodisa — avvalgidek logda va tasdiqlanadi (DLQ ni to‘ldirmaydi)', async () => {
    await firstValueFrom(client.emit('probe.unknown', {}), {
      defaultValue: undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await ready(queue)).toBe(0);
    expect(await ready(dlq)).toBe(1);
  });

  it('so‘rov: javob qaytadi; xato javob ham — ikkalasi tasdiqlanadi, DLQ ga tushmaydi', async () => {
    await expect(
      firstValueFrom(client.send({ cmd: 'probe.echo' }, { text: 'salom' })),
    ).resolves.toEqual({ echoed: 'salom' });
    await expect(
      firstValueFrom(client.send({ cmd: 'probe.boom' }, {})),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(calls.boom).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await ready(queue)).toBe(0);
    expect(await ready(dlq)).toBe(1);
  });

  it('iste’molchi to‘xtaganda tasdiqlanmagan xabar qolmagan (hammasi ack yoki DLQ)', async () => {
    await app.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await ready(queue)).toBe(0);
    expect(calls).toMatchObject({ ok: 1, fail: 3, boom: 1 });
  });
});
