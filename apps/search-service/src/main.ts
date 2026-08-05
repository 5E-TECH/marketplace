import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { RmqQueue, rmqOptions } from '@app/common';
import { SearchModule } from './search.module';

async function bootstrap() {
  const app = await NestFactory.create(SearchModule);
  const config = app.get(ConfigService);
  app.connectMicroservice(
    rmqOptions([config.getOrThrow<string>('RABBITMQ_URL')], RmqQueue.SEARCH),
  );
  await app.startAllMicroservices();
  Logger.log(
    `🔎 search-service RMQ tinglayapti (${RmqQueue.SEARCH})`,
    'Bootstrap',
  );
}

bootstrap();
