import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Client } from 'pg';

/**
 * Servis uchun TypeORM sozlamalari (schema-per-service).
 * Sxema faqat migratsiyadan (BE-04): dev ham, prod ham — `npm run db:migrate:check` toza bazada farqni tekshiradi.
 */
export function typeOrmOptions(
  config: ConfigService,
  schema: string,
  entities: TypeOrmModuleOptions['entities'],
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
    // BE-04: hech qayerda synchronize yo‘q — sxema faqat migratsiyadan (dev ham), entity o‘zgarsa sxema o‘zi o‘zgarmaydi.
    synchronize: false,
    logging: false,
  };
}

/**
 * Migratsiya dastur ko'tarilishida avtomat ishlasinmi.
 * `DB_AUTO_MIGRATE=false` bo'lsa — yo'q; migratsiya deploy'da alohida
 * qadam sifatida boshqariladi (katta jadvalda lock'ni nazorat qilish uchun).
 */
export function shouldRunMigrations(config: ConfigService): boolean {
  return config.get<boolean>('DB_AUTO_MIGRATE', true) !== false;
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
