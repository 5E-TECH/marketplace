#!/usr/bin/env node
/**
 * BE-02: eski navbatlardan (`<servis>_queue`) yangi DLQ li navbatlarga (`<servis>_queue_v2`) qolgan xabarlarni
 * ko‘chiradi va bo‘shagan eski navbatni o‘chiradi. Yangi servislar ishga tushgandan keyin bir marta.
 *
 *   RABBITMQ_URL=amqp://... node scripts/rmq-migrate-v2.mjs           # faqat ko‘rsatadi
 *   RABBITMQ_URL=amqp://... node scripts/rmq-migrate-v2.mjs --apply   # ko‘chiradi va o‘chiradi
 *
 * Faqat HAMMA eski konteynerlar to‘xtagandan keyin ishga tushiring: eski navbat o‘chirilgach eski versiyadagi
 * yuboruvchi xabarni yo‘qqa yuborardi. Eski navbatni hali tinglayotgan bo‘lsa, o‘chirilmaydi (`ifUnused`).
 * Eski RPC so‘rovlari (javob kutgan chaqiruvchi allaqachon yo‘q) ko‘chirilmaydi — tashlanadi va sanaladi.
 */
import amqp from 'amqplib';

const SERVICES = [
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
/**
 * BE-29: o‘chirilgan servis (echo-service) navbatlari — ko‘chirilmaydi, tinglovchisi yo‘q bo‘lsa xabarlari bilan
 * o‘chiriladi (echo faqat RPC so‘rovi qabul qilardi, javob kutgan chaqiruvchi yo‘q).
 */
const RETIRED = ['echo_queue', 'echo_queue_v2', 'echo_queue_v2.dlq'];
const apply = process.argv.includes('--apply');
const url = process.env.RABBITMQ_URL;
if (!url) {
  console.error('RABBITMQ_URL kerak');
  process.exit(2);
}

/** libs/common/src/messaging/rmq.util.ts bilan bir xil (argumentlar farq qilsa RabbitMQ PRECONDITION_FAILED beradi). */
const queueOptions = (queue) => ({
  durable: true,
  deadLetterExchange: '',
  deadLetterRoutingKey: `${queue}.dlq`,
});
const DLQ_OPTIONS = { durable: true, messageTtl: 14 * 24 * 60 * 60 * 1000 };

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
    // tasdiqli kanal: eski navbatdan faqat broker nusxani qabul qilgach o‘chiriladi
    const channel = await connection.createConfirmChannel();
    try {
      await channel.assertQueue(next, queueOptions(next));
      await channel.assertQueue(`${next}.dlq`, DLQ_OPTIONS);
      let moved = 0;
      let dropped = 0;
      for (;;) {
        const message = await channel.get(old, { noAck: false });
        if (!message) break;
        if (message.properties.replyTo) {
          channel.ack(message); // eskirgan RPC so‘rovi
          dropped++;
          continue;
        }
        channel.sendToQueue(next, message.content, {
          ...message.properties,
          persistent: true,
        });
        await channel.waitForConfirms();
        channel.ack(message);
        moved++;
      }
      await channel.deleteQueue(old, { ifUnused: true, ifEmpty: true });
      console.log(
        `${old}: ${moved} ta hodisa ko‘chirildi, ${dropped} ta eski RPC so‘rovi tashlandi, navbat o‘chirildi`,
      );
    } catch (error) {
      failed = true;
      console.error(
        `${old}: ${error.message} (eski servis hali tinglayaptimi?)`,
      );
    } finally {
      await channel.close().catch(() => undefined);
    }
  }
  for (const queue of RETIRED) {
    const count = await messageCount(connection, queue);
    if (count === null) {
      console.log(`${queue}: yo‘q`);
      continue;
    }
    console.log(
      `${queue}: o‘chirilgan servis navbati, ${count} ta xabar — o‘chiriladi${apply ? '' : ' (faqat ko‘rsatildi)'}`,
    );
    if (!apply) continue;
    const channel = await connection.createChannel();
    try {
      await channel.deleteQueue(queue, { ifUnused: true });
      console.log(`${queue}: o‘chirildi`);
    } catch (error) {
      failed = true;
      console.error(`${queue}: ${error.message} (echo-service hali ishlayaptimi?)`);
    } finally {
      await channel.close().catch(() => undefined);
    }
  }
} finally {
  await connection.close();
}
process.exit(failed ? 1 : 0);
