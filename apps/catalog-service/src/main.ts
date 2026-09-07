import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { RmqQueue, rmqOptions } from '@app/common';
import { CatalogModule } from './catalog.module';

async function bootstrap() {
  const app = await NestFactory.create(CatalogModule);
  const config = app.get(ConfigService);

  app.connectMicroservice(
    rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.CATALOG),
  );
  await app.startAllMicroservices();
  // CategorySeeder.onApplicationBootstrap() ishlashi uchun HTTP app contextini
  // ham init qilish kerak. Aks holda RMQ ko‘tariladi, lekin seed hook chaqirilmaydi.
  await app.init();

  Logger.log(
    `📦 catalog-service RMQ tinglayapti (${RmqQueue.CATALOG})`,
    'Bootstrap',
  );
}

bootstrap();
