import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { RmqQueue, rmqOptions } from '@app/common';
import { CheckoutModule } from './checkout.module';

async function bootstrap() {
  const app = await NestFactory.create(CheckoutModule);
  const config = app.get(ConfigService);
  app.connectMicroservice(
    rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.CHECKOUT),
  );
  await app.startAllMicroservices();
  // Hybrid app'da lifecycle hook'lar (@Cron, onModuleInit) faqat init'da
  // ishga tushadi — connectMicroservice ularni chaqirmaydi.
  await app.init();
  Logger.log(
    `🛒 checkout-service RMQ tinglayapti (${RmqQueue.CHECKOUT})`,
    'Bootstrap',
  );
}

bootstrap();
