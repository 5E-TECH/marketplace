#!/usr/bin/env node
/**
 * Swagger (OpenAPI) hujjatini JSON faylga chiqaradi — kontrakt nazorati uchun.
 * Frontend shu faylga qarab o'zi chaqirayotgan endpointlar hali ham mavjudligini
 * tekshiradi (Marketplace-FrontEnd → npm run contract:check).
 *
 * Ishlatish:  npm run build:all && npm run contract:export
 * Natija:     docs/openapi.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = process.env.OPENAPI_OUT ?? resolve(root, 'docs/openapi.json');

// Hujjat generatsiyasi uchun haqiqiy infratuzilma kerak emas — Joi sxemasini
// qanoatlantiradigan o'rinbosar qiymatlar yetarli. Hech qanday ulanish ochilmaydi.
const placeholders = {
  NODE_ENV: 'development',
  DB_HOST: 'localhost',
  DB_USERNAME: 'openapi',
  DB_PASSWORD: 'openapi',
  DB_NAME: 'openapi',
  RABBITMQ_URL: 'amqp://localhost:5672',
  MINIO_ENDPOINT: 'localhost',
  MINIO_ACCESS_KEY: 'openapi-access-key',
  MINIO_SECRET_KEY: 'openapi-secret-key',
  MINIO_PUBLIC_URL: 'http://localhost:9000',
  JWT_SECRET: 'openapi-placeholder-secret-value',
  JWT_REFRESH_SECRET: 'openapi-placeholder-refresh-secret',
  INTEGRATION_CREDENTIAL_SECRET: 'openapi-placeholder-integration-secret',
};
for (const [key, value] of Object.entries(placeholders)) {
  process.env[key] ??= value;
}

const { NestFactory } = await import('@nestjs/core');
const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
const { AppModule } = await import(
  resolve(root, 'dist/apps/api-gateway/apps/api-gateway/src/app.module.js')
);

const app = await NestFactory.create(AppModule, { logger: false });
app.setGlobalPrefix('api/v1');

const config = new DocumentBuilder()
  .setTitle('Elchi Marketplace API')
  .setDescription('Marketplace API — MVP (batafsil: docs/API_CONTRACT.md)')
  .setVersion('0.1')
  .addBearerAuth()
  .build();

const document = SwaggerModule.createDocument(app, config);
await app.close();

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`);

const routes = Object.keys(document.paths ?? {}).length;
console.log(`OpenAPI yozildi: ${outFile} (${routes} ta yo'l)`);
