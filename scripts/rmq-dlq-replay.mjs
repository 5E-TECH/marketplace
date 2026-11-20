#!/usr/bin/env node
/**
 * BE-02: DLQ dagi (`<navbat>.dlq`) xabarlarni asosiy navbatga qaytaradi — sabab tuzatilgandan keyin.
 *
 *   RABBITMQ_URL=amqp://... node scripts/rmq-dlq-replay.mjs checkout_queue_v2            # faqat ko‘rsatadi
 *   RABBITMQ_URL=amqp://... node scripts/rmq-dlq-replay.mjs checkout_queue_v2 --apply    # qaytaradi
 *   ... --limit 10                                                                       # birinchi 10 tasi
 *
 * Qaytgan xabar yana bir marta qayta urinadi; yana yiqilsa — DLQ ga qaytadi. Iste’molchilar `eventId` bo‘yicha
 * takrorni tashlaydi (processOnce), shuning uchun qayta yuborish xavfsiz.
 */
import amqp from 'amqplib';

const queue = process.argv[2];
const apply = process.argv.includes('--apply');
const limitIndex = process.argv.indexOf('--limit');
const limit =
  limitIndex > 0
    ? Number(process.argv[limitIndex + 1])
    : Number.POSITIVE_INFINITY;
const url = process.env.RABBITMQ_URL;
if (!url || !queue || queue.startsWith('--') || !(limit > 0)) {
  console.error(
    'Foydalanish: RABBITMQ_URL=... node scripts/rmq-dlq-replay.mjs <navbat> [--limit N] [--apply]',
  );
  process.exit(2);
}
const dlq = `${queue}.dlq`;
const connection = await amqp.connect(url);
const channel = await connection.createChannel();
try {
  const { messageCount } = await channel.checkQueue(dlq);
  console.log(
    `${dlq}: ${messageCount} ta xabar${apply ? '' : ' (faqat ko‘rsatildi)'}`,
  );
  let moved = 0;
  while (apply && moved < limit) {
    const message = await channel.get(dlq, { noAck: false });
    if (!message) break;
    channel.sendToQueue(queue, message.content, {
      ...message.properties,
      persistent: true,
    });
    channel.ack(message);
    moved++;
  }
  if (apply) console.log(`${moved} ta xabar ${queue} ga qaytarildi`);
} finally {
  await channel.close().catch(() => undefined);
  await connection.close();
}
