import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RmqQueue, rmqOptions } from '@app/common';
import { EchoModule } from './echo.module';

/**
 * Microservice (RMQ tinglaydi, HTTP emas). Barcha real servislar shu shablonda:
 * ConfigModule → connectMicroservice(rmqOptions) → startAllMicroservices → init.
 */
async function bootstrap() {
  const app = await NestFactory.create(EchoModule);
  const config = app.get(ConfigService);
  const url = config.get<string>('RABBITMQ_URL')!;

  app.connectMicroservice(rmqOptions([url], RmqQueue.ECHO));
  await app.startAllMicroservices();
  // Hybrid app'da lifecycle hook'lar (@Cron, onModuleInit) faqat init'da
  // ishga tushadi — connectMicroservice ularni chaqirmaydi.
  await app.init();

  Logger.log(`📨 echo-service RMQ tinglayapti (${RmqQueue.ECHO})`, 'Bootstrap');
}

bootstrap();
