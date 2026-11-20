import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { RmqQueue, rmqServer } from '@app/common';
import { LeadModule } from './lead.module';

async function bootstrap() {
  const app = await NestFactory.create(LeadModule);
  const config = app.get(ConfigService);

  // 4xx xatolar gateway'ga o‘z kodi bilan yetishi uchun har controller'da
  // @UseFilters(RpcHttpExceptionFilter) bo‘ladi (repo qoidasi). connectMicroservice'dan
  // keyin microservice.useGlobalFilters() handlerlarga yetmaydi — RMQ da tekshirildi.
  app.connectMicroservice(
    rmqServer([config.getOrThrow<string>('RABBITMQ_URL')], RmqQueue.LEAD),
  );
  await app.startAllMicroservices();
  // Hybrid app'da lifecycle hook'lar (@Cron, onModuleInit) faqat init'da ishga tushadi.
  await app.init();

  Logger.log(`📇 lead-service RMQ tinglayapti (${RmqQueue.LEAD})`, 'Bootstrap');
}

void bootstrap();
