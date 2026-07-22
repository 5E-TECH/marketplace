import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter, TransformInterceptor } from '@app/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>('API_GATEWAY_PORT', 3000);

  // API_CONTRACT.md §1.1 — barcha route /api/v1 prefiksi bilan
  app.setGlobalPrefix('api/v1');

  // Global: validatsiya, javob qobig'i, xato filtri
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger — /api/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Elchi Marketplace API')
    .setDescription('Marketplace API — MVP (batafsil: docs/API_CONTRACT.md)')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port);
  Logger.log(
    `🚀 API Gateway: http://localhost:${port}/api/v1  (Swagger: /api/docs)`,
    'Bootstrap',
  );
}

bootstrap();
