import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import {
  AllExceptionsFilter,
  HttpLoggerInterceptor,
  TransformInterceptor,
} from '@app/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);
  const port = config.get<number>('API_GATEWAY_PORT', 3000);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  // Caddy/nginx orqasida turamiz — haqiqiy mijoz IP'sini `X-Forwarded-For`dan
  // olamiz. Rate limiting shu IP bo'yicha hisoblaydi, shuning uchun majburiy.
  app.set('trust proxy', config.get<number>('TRUST_PROXY_HOPS', 1));

  // Xavfsizlik sarlavhalari. Swagger UI o'z skript/uslublarini inline yuklaydi,
  // shuning uchun CSP'da 'unsafe-inline' ochiq — bu faqat API hostiga tegishli,
  // frontend uchun qat'iyroq CSP Caddy'da beriladi.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          ...(isProduction ? {} : { upgradeInsecureRequests: null }),
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    }),
  );

  // Lokal developmentda bir xil Wi‑Fi'dagi frontend API'ga ulana oladi.
  // Productionda CORS_ORIGINS vergul bilan ajratilgan aniq domenlar bo'lishi kerak.
  const configuredOrigins = config
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (isProduction && configuredOrigins.length === 0) {
    Logger.warn(
      'CORS_ORIGINS bo‘sh — productionda hech qaysi brauzer origin’i API’ga ulana olmaydi',
      'Bootstrap',
    );
  }
  app.enableCors({
    origin: configuredOrigins.length > 0 ? configuredOrigins : !isProduction,
    credentials: true,
    // Frontend xatoni log bilan solishtira olishi uchun ID'ni ochamiz.
    exposedHeaders: ['X-Request-Id'],
  });

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
  app.useGlobalInterceptors(
    new HttpLoggerInterceptor(),
    new TransformInterceptor(),
  );
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

  await app.listen(port, '0.0.0.0');
  Logger.log(
    `🚀 API Gateway: http://localhost:${port}/api/v1  (Swagger: /api/docs)`,
    'Bootstrap',
  );
}

bootstrap();
