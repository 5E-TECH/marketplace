import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { RmqQueue, rmqServer } from '@app/common';
import { NotificationModule } from './notification.module';

async function bootstrap() {
  const app = await NestFactory.create(NotificationModule);
  const config = app.get(ConfigService);
  app.connectMicroservice(
    rmqServer(
      [config.getOrThrow<string>('RABBITMQ_URL')],
      RmqQueue.NOTIFICATION,
      // BE-02: bildirishnoma qayta urinishda SMS/email takror ketishi mumkin — avtomatik qayta urinish yo‘q, DLQ dan qo‘lda
      { maxAttempts: 1 },
    ),
  );
  await app.startAllMicroservices();
  // Hybrid app'da lifecycle hook'lar (@Cron, onModuleInit) faqat init'da
  // ishga tushadi — connectMicroservice ularni chaqirmaydi.
  await app.init();
  Logger.log(
    `🔔 notification-service RMQ tinglayapti (${RmqQueue.NOTIFICATION})`,
    'Bootstrap',
  );
}

bootstrap();
