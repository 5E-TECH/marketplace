import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { RmqQueue, rmqOptions } from '@app/common';
import { NotificationModule } from './notification.module';

async function bootstrap() {
  const app = await NestFactory.create(NotificationModule);
  const config = app.get(ConfigService);
  app.connectMicroservice(
    rmqOptions(
      [config.getOrThrow<string>('RABBITMQ_URL')],
      RmqQueue.NOTIFICATION,
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
