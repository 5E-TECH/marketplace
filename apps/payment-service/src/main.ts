import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { RmqQueue, rmqOptions } from '@app/common';
import { PaymentModule } from './payment.module';

async function bootstrap() {
  const app = await NestFactory.create(PaymentModule);
  const config = app.get(ConfigService);
  app.connectMicroservice(
    rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.PAYMENT),
  );
  await app.startAllMicroservices();
  Logger.log(
    `💳 payment-service RMQ tinglayapti (${RmqQueue.PAYMENT})`,
    'Bootstrap',
  );
}

bootstrap();
