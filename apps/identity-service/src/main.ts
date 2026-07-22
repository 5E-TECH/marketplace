import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RmqQueue, rmqOptions } from '@app/common';
import { IdentityModule } from './identity.module';

async function bootstrap() {
  const app = await NestFactory.create(IdentityModule);
  const config = app.get(ConfigService);

  app.connectMicroservice(
    rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.IDENTITY),
  );
  await app.startAllMicroservices();
  // Seeder OnApplicationBootstrap uchun init ham kerak
  await app.init();

  Logger.log(
    `🔐 identity-service RMQ tinglayapti (${RmqQueue.IDENTITY})`,
    'Bootstrap',
  );
}

bootstrap();
