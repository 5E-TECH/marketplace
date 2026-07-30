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
  Logger.log(
    `🛒 checkout-service RMQ tinglayapti (${RmqQueue.CHECKOUT})`,
    'Bootstrap',
  );
}

bootstrap();
