#!/usr/bin/env node
/**
 * BE-02: DLQ dagi (`<navbat>.dlq`) xabarlarni asosiy navbatga qaytaradi — sabab tuzatilgandan keyin.
 *
 *   RABBITMQ_URL=amqp://... node scripts/rmq-dlq-replay.mjs checkout_queue_v2            # faqat ko‘rsatadi
 *   RABBITMQ_URL=amqp://... node scripts/rmq-dlq-replay.mjs checkout_queue_v2 --apply    # qaytaradi
 *   ... --limit 10                                                                       # birinchi 10 tasi
 *
 * Faqat boshlanishdagi xabarlar soni ko‘chiriladi: jonli iste’molchi qayta yiqitgan xabar DLQ ga qaytsa, skript
 * cheksiz aylanmaydi. Qaytgan xabar odatdagidek qayta urinadi (sanoq yangidan); yana yiqilsa — DLQ ga qaytadi.
 *
 * DIQQAT: hamma iste’molchi takrorga chidamli emas. Moliya, lid va Elchi integratsiyasi `eventId` bo‘yicha takrorni
 * tashlaydi (processOnce); bildirishnoma (SMS, email), qidiruv va `payment.paid` — yo‘q. Bildirishnoma navbatini
 * qaytarishdan oldin xabarlarni ko‘rib chiqing (`--limit`).
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
// tasdiqli kanal: xabar DLQ dan faqat broker nusxani qabul qilgach o‘chiriladi
const channel = await connection.createConfirmChannel();
try {
  const { messageCount } = await channel.checkQueue(dlq);
  console.log(
    `${dlq}: ${messageCount} ta xabar${apply ? '' : ' (faqat ko‘rsatildi)'}`,
  );
  const total = Math.min(messageCount, limit);
  let moved = 0;
  while (apply && moved < total) {
    const message = await channel.get(dlq, { noAck: false });
    if (!message) break;
    const headers = { ...(message.properties.headers ?? {}) };
    delete headers['x-elchi-attempt']; // qayta urinishlar sanog‘i yangidan
    channel.sendToQueue(queue, message.content, {
      ...message.properties,
      headers,
      persistent: true,
    });
    await channel.waitForConfirms();
    channel.ack(message);
    moved++;
  }
  if (apply) console.log(`${moved} ta xabar ${queue} ga qaytarildi`);
} finally {
  await channel.close().catch(() => undefined);
  await connection.close();
}
