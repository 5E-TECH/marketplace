import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Client } from 'pg';

/**
 * Servis uchun TypeORM sozlamalari (schema-per-service).
 * dev'da synchronize=true (jadvallarni avtomat yaratadi); prod'da migratsiya ishlatiladi.
 */
export function typeOrmOptions(
  config: ConfigService,
  schema: string,
  entities: Function[],
): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: config.get<string>('DB_HOST'),
    port: config.get<number>('DB_PORT'),
    username: config.get<string>('DB_USERNAME'),
    password: config.get<string>('DB_PASSWORD'),
    database: config.get<string>('DB_NAME'),
    schema,
    entities,
    synchronize: config.get<string>('NODE_ENV') !== 'production',
    logging: false,
  };
}

/**
 * Servis schema'si mavjudligini ta'minlaydi (dev qulayligi).
 * TypeORM synchronize schema'ni o'zi yaratmaydi — shuning uchun oldindan yaratamiz.
 */
export async function ensureSchema(
  config: ConfigService,
  schema: string,
): Promise<void> {
  const client = new Client({
    host: config.get<string>('DB_HOST'),
    port: config.get<number>('DB_PORT'),
    user: config.get<string>('DB_USERNAME'),
    password: config.get<string>('DB_PASSWORD'),
    database: config.get<string>('DB_NAME'),
  });
  await client.connect();
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await client.end();
}
