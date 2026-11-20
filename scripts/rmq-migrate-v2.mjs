#!/usr/bin/env node
/**
 * BE-02: eski navbatlardan (`<servis>_queue`) yangi DLQ li navbatlarga (`<servis>_queue_v2`) qolgan xabarlarni
 * ko‘chiradi va bo‘shagan eski navbatni o‘chiradi. Yangi servislar ishga tushgandan keyin bir marta.
 *
 *   RABBITMQ_URL=amqp://... node scripts/rmq-migrate-v2.mjs           # faqat ko‘rsatadi
 *   RABBITMQ_URL=amqp://... node scripts/rmq-migrate-v2.mjs --apply   # ko‘chiradi va o‘chiradi
 *
 * Eski navbatni hali eski servis tinglayotgan bo‘lsa, o‘chirilmaydi (`ifUnused`) — avval eski servislar to‘xtasin.
 */
import amqp from 'amqplib';

const SERVICES = [
  'echo',
  'identity',
  'catalog',
  'inventory',
  'checkout',
  'payment',
  'finance',
  'integration',
  'notification',
  'search',
  'file',
  'lead',
];
const apply = process.argv.includes('--apply');
const url = process.env.RABBITMQ_URL;
if (!url) {
  console.error('RABBITMQ_URL kerak');
  process.exit(2);
}

/** libs/common/src/messaging/rmq.util.ts `rmqQueueOptions` bilan bir xil. */
const queueOptions = (queue) => ({
  durable: true,
  deadLetterExchange: '',
  deadLetterRoutingKey: `${queue}.dlq`,
});

async function messageCount(connection, queue) {
  const channel = await connection.createChannel();
  try {
    return (await channel.checkQueue(queue)).messageCount;
  } catch {
    return null; // navbat yo‘q (kanal yopiladi)
  } finally {
    await channel.close().catch(() => undefined);
  }
}

const connection = await amqp.connect(url);
let failed = false;
try {
  for (const service of SERVICES) {
    const old = `${service}_queue`;
    const next = `${service}_queue_v2`;
    const count = await messageCount(connection, old);
    if (count === null) {
      console.log(`${old}: yo‘q`);
      continue;
    }
    console.log(
      `${old}: ${count} ta xabar → ${next}${apply ? '' : ' (faqat ko‘rsatildi)'}`,
    );
    if (!apply) continue;
    const channel = await connection.createChannel();
    try {
      await channel.assertQueue(next, queueOptions(next));
      await channel.assertQueue(`${next}.dlq`, { durable: true });
      let moved = 0;
      for (;;) {
        const message = await channel.get(old, { noAck: false });
        if (!message) break;
        channel.sendToQueue(next, message.content, {
          ...message.properties,
          persistent: true,
        });
        channel.ack(message);
        moved++;
      }
      await channel.deleteQueue(old, { ifUnused: true, ifEmpty: true });
      console.log(`${old}: ${moved} ta ko‘chirildi, navbat o‘chirildi`);
    } catch (error) {
      failed = true;
      console.error(
        `${old}: ${error.message} (eski servis hali tinglayaptimi?)`,
      );
    } finally {
      await channel.close().catch(() => undefined);
    }
  }
} finally {
  await connection.close();
}
process.exit(failed ? 1 : 0);
