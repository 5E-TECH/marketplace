import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Client } from 'pg';

/**
 * Servis uchun TypeORM sozlamalari (schema-per-service).
 * Sxema faqat migratsiyadan (BE-04): dev ham, prod ham. CI bo‘sh bazada `db:migrate:check` bilan farqni tekshiradi;
 * lokal tekshiruv uchun ham bo‘sh baza oling — eski dev bazasida `synchronize` yaratgan ustunlar farqni yashiradi.
 */
export function typeOrmOptions(
  config: ConfigService,
  schema: string,
  entities: TypeOrmModuleOptions['entities'],
): TypeOrmModuleOptions {
  const credentials = dbCredentials(config, schema);
  return {
    type: 'postgres',
    host: config.get<string>('DB_HOST'),
    port: config.get<number>('DB_PORT'),
    username: credentials.user,
    password: credentials.password,
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
export function shouldRunMigrations(
  config: ConfigService,
  env: Record<string, string | undefined> = process.env,
): boolean {
  // BE-36: servis rollari faqat DML qila oladi (00-bootstrap.sql) — migratsiya CLI bilan, mkt_migrator nomidan
  if (perServiceRolesEnabled(env)) return false;
  return config.get<boolean>('DB_AUTO_MIGRATE', true) !== false;
}

/**
 * BE-36 (T9-16): har servis o‘z DB roli bilan — `docs/schema/00-bootstrap.sql` dagi `mkt_<sxema>`, faqat o‘z sxemasida
 * SELECT/INSERT/UPDATE/DELETE; boshqa servis sxemasiga USAGE yo‘q (TC2). `DB_USERNAME_<SXEMA>` va
 * `DB_PASSWORD_<SXEMA>` berilmasa — umumiy `DB_USERNAME`/`DB_PASSWORD` (dev va eski deploy).
 */
export function dbCredentials(
  config: ConfigService,
  schema: string,
): {
  user: string | undefined;
  password: string | undefined;
  perService: boolean;
} {
  const suffix = schema.toUpperCase();
  const user = config.get<string>(`DB_USERNAME_${suffix}`);
  if (user)
    return {
      user,
      password: config.get<string>(`DB_PASSWORD_${suffix}`),
      perService: true,
    };
  return {
    user: config.get<string>('DB_USERNAME'),
    password: config.get<string>('DB_PASSWORD'),
    perService: false,
  };
}

/** Kamida bitta servis o‘z roli bilan sozlangan (umumiy `.env.production`) — servislar migratsiya qilmaydi. */
export function perServiceRolesEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Object.keys(env).some(
    (key) => /^DB_USERNAME_[A-Z]+$/.test(key) && !!env[key]?.trim(),
  );
}

/**
 * Servis schema'si mavjudligini ta'minlaydi (dev qulayligi).
 * TypeORM synchronize schema'ni o'zi yaratmaydi — shuning uchun oldindan yaratamiz.
 */
export async function ensureSchema(
  config: ConfigService,
  schema: string,
): Promise<void> {
  const credentials = dbCredentials(config, schema);
  const client = new Client({
    host: config.get<string>('DB_HOST'),
    port: config.get<number>('DB_PORT'),
    user: credentials.user,
    password: credentials.password,
    database: config.get<string>('DB_NAME'),
  });
  await client.connect();
  try {
    // BE-36: servis roli bazada sxema yarata olmaydi — bor bo‘lsa so‘ralmaydi (sxemani bootstrap yaratadi)
    const exists = await client.query(
      'SELECT 1 FROM pg_namespace WHERE nspname = $1',
      [schema],
    );
    if (!exists.rowCount)
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  } finally {
    await client.end();
  }
}
