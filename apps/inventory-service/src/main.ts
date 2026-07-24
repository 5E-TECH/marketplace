import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { RmqQueue, rmqOptions } from '@app/common';
import { InventoryModule } from './inventory.module';

async function bootstrap() {
  const app = await NestFactory.create(InventoryModule);
  const config = app.get(ConfigService);

  app.connectMicroservice(
    rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.INVENTORY),
  );
  await app.startAllMicroservices();

  Logger.log(
    `📦 inventory-service RMQ tinglayapti (${RmqQueue.INVENTORY})`,
    'Bootstrap',
  );
}

bootstrap();
