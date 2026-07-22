import { Logger } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';

const logger = new Logger('executeAndAck');

/**
 * RabbitMQ message handler'lari uchun yordamchi (Elchi patterni).
 * Handler funksiyasini bajaradi va muvaffaqiyatda xabarni `ack` qiladi.
 * Xato bo'lsa — `nack` (requeue=false, ya'ni DLQ/tashlab yuborish) va xatoni qayta tashlaydi.
 */
export async function executeAndAck<T>(
  context: RmqContext,
  handler: () => Promise<T>,
): Promise<T> {
  const channel = context.getChannelRef();
  const message = context.getMessage();
  try {
    const result = await handler();
    channel.ack(message);
    return result;
  } catch (error) {
    logger.error(
      `Handler xatosi, nack: ${(error as Error).message}`,
      (error as Error).stack,
    );
    channel.nack(message, false, false);
    throw error;
  }
}
