import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { RmqQueue, rmqOptions } from '@app/common';
import { FileServiceModule } from './file-service.module';

async function bootstrap() {
  const app = await NestFactory.create(FileServiceModule);
  const config = app.get(ConfigService);

  app.connectMicroservice(
    rmqOptions([config.getOrThrow<string>('RABBITMQ_URL')], RmqQueue.FILE),
  );
  await app.startAllMicroservices();

  Logger.log(`🗂️ file-service RMQ tinglayapti (${RmqQueue.FILE})`, 'Bootstrap');
}

bootstrap();
