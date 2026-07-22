import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>('API_GATEWAY_PORT', 3000);

  // API_CONTRACT.md §1.1 — barcha route /api/v1 prefiksi bilan
  app.setGlobalPrefix('api/v1');

  await app.listen(port);
  Logger.log(`🚀 API Gateway ishga tushdi: http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap();
