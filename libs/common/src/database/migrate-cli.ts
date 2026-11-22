import type { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';
import { DataSource, type MigrationInterface } from 'typeorm';

/**
 * Servis bazasi (BE-04): sxema, entity va migratsiyalar. Modul ham, migratsiya CLI ham shu ro‘yxatni ishlatadi —
 * dev sxemasi migratsiyadan farq qilmaydi (`synchronize` hech qayerda yo‘q).
 */
export interface DatabaseDefinition {
  schema: string;
  entities: EntityClassOrSchema[];
  migrations: Array<new () => MigrationInterface>;
}

type Env = Record<string, string | undefined>;

/** Servis bilan bir xil ulanish: `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`; yoki `MIGRATE_DATABASE_URL`. */
export function migrationDataSource(
  def: DatabaseDefinition,
  env: Env = process.env,
): DataSource {
  const url = env.MIGRATE_DATABASE_URL;
  return new DataSource({
    type: 'postgres',
    ...(url
      ? { url }
      : {
          host: env.DB_HOST,
          port: Number(env.DB_PORT ?? 5432),
          username: env.DB_USERNAME,
          password: env.DB_PASSWORD,
          database: env.DB_NAME,
        }),
    schema: def.schema,
    entities: def.entities as never,
    migrations: def.migrations,
    synchronize: false,
    migrationsRun: false,
    logging: false,
  });
}

/** information_schema turi → TypeORM `normalizeType` nomi (PostgreSQL). */
const TYPE_ALIASES: Record<string, string> = {
  'timestamp without time zone': 'timestamp without time zone',
  'timestamp with time zone': 'timestamp with time zone',
  'character varying': 'character varying',
  character: 'character',
};

/** Bazadagi sukut ifodasi oddiy qiymatga: `'ACTIVE'::character varying` → `ACTIVE`, `'0'::bigint` → `0`, `(-1)` → `-1`. */
function plainDefault(value: string): string {
  const quoted = /^'((?:[^']|'')*)'(?:::.+)?$/s.exec(value);
  if (quoted) return quoted[1].replace(/''/g, "'");
  const number = /^\(?(-?\d+(?:\.\d+)?)\)?(?:::.+)?$/.exec(value);
  return number ? number[1] : value;
}

/**
 * Entity’ning oddiy sukuti (satr, son, mantiqiy) bazadagisi bilan bir xilmi. Funksiya sukuti (`() => 'now()'`) va
 * obyekt solishtirilmaydi. Masalan, catalog’dagi `'active'` / `'ACTIVE'` xatosi shu yerda ushlanadi.
 */
function compareDefault(entity: unknown, db: string | null): string | null {
  if (
    typeof entity !== 'string' &&
    typeof entity !== 'number' &&
    typeof entity !== 'boolean'
  )
    return null;
  if (db === null) return `yo‘q (entity ${String(entity)})`;
  const have = plainDefault(db);
  const same =
    typeof entity === 'number'
      ? Number(have) === entity
      : have === String(entity);
  return same ? null : `farq qiladi (entity ${String(entity)}, bazada ${have})`;
}

/**
 * Migratsiyalardan keyingi sxema entity’larga yetadimi: har entity jadvali, har ustuni bor, turi, NULL ga ruxsati va
 * oddiy sukut qiymati mos. TypeORM’ning o‘z `schema:log` i bu yerda yaramaydi — migratsiyalar SQL da yozilgan (CHECK,
 * qisman indeks, FK), u ularni o‘chirishni taklif qiladi. Indeks, unique, CHECK va FK solishtirilmaydi; bazadagi
 * ortiqcha cheklovlar xato emas. Bo‘sh bazada ishlating (CI): eski dev bazasida `synchronize` yaratgan ustunlar
 * farqni yashiradi.
 */
export async function schemaDrift(
  ds: DataSource,
  schema: string,
): Promise<string[]> {
  const rows = (await ds.query(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1`,
    [schema],
  )) as Array<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: 'YES' | 'NO';
    column_default: string | null;
  }>;
  const tables = new Map<string, Map<string, (typeof rows)[number]>>();
  for (const row of rows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, new Map());
    tables.get(row.table_name)!.set(row.column_name, row);
  }
  const problems: string[] = [];
  for (const meta of ds.entityMetadatas) {
    if (meta.tableType !== 'regular' && meta.tableType !== 'entity-child')
      continue;
    if ((meta.schema ?? schema) !== schema) continue;
    const columns = tables.get(meta.tableName);
    if (!columns) {
      problems.push(`jadval yo‘q: ${schema}.${meta.tableName} (${meta.name})`);
      continue;
    }
    for (const column of meta.columns) {
      if (column.isVirtual) continue;
      const db = columns.get(column.databaseName);
      const where = `${schema}.${meta.tableName}.${column.databaseName}`;
      if (!db) {
        problems.push(`ustun yo‘q: ${where}`);
        continue;
      }
      const want = column.isArray ? 'ARRAY' : ds.driver.normalizeType(column);
      const have =
        db.data_type === 'USER-DEFINED'
          ? 'enum'
          : (TYPE_ALIASES[db.data_type] ?? db.data_type);
      if (want !== have && !(want === 'enum' && have === 'character varying'))
        problems.push(
          `tur farq qiladi: ${where} — entity ${want}, bazada ${have}`,
        );
      const defaultProblem = compareDefault(column.default, db.column_default);
      if (defaultProblem) problems.push(`sukut ${defaultProblem}: ${where}`);
      if (column.isNullable !== (db.is_nullable === 'YES')) {
        problems.push(
          `NULL farq qiladi: ${where} — entity ${column.isNullable ? 'NULL mumkin' : 'NOT NULL'}, bazada ${db.is_nullable === 'YES' ? 'NULL mumkin' : 'NOT NULL'}`,
        );
      }
    }
  }
  return problems;
}

const COMMANDS = ['run', 'revert', 'show', 'check'] as const;
type Command = (typeof COMMANDS)[number];

async function pending(ds: DataSource): Promise<string[]> {
  const table = `"${ds.driver.schema}"."migrations"`;
  const exists = (await ds.query(`SELECT to_regclass($1) AS t`, [
    `${ds.driver.schema}.migrations`,
  ])) as Array<{ t: string | null }>;
  const done = new Set<string>(
    exists[0]?.t
      ? (
          (await ds.query(`SELECT name FROM ${table}`)) as Array<{
            name: string;
          }>
        ).map((row) => row.name)
      : [],
  );
  return ds.migrations
    .map((migration) => migration.name ?? migration.constructor.name)
    .filter((name) => !done.has(name));
}

/**
 * BE-36: servis roli (`DB_USERNAME_<SXEMA>`, bo‘lmasa `mkt_<sxema>`) migratsiya jurnalini o‘zgartira olmasin — bootstrap dagi
 * default huquqlar migrator yaratgan har jadvalga DML beradi. Rol yo‘q bo‘lsa (umumiy foydalanuvchi) — hech narsa.
 */
async function protectMigrationHistory(
  ds: DataSource,
  schema: string,
  env: Env,
): Promise<void> {
  const role =
    env[`DB_USERNAME_${schema.toUpperCase()}`]?.trim() || `mkt_${schema}`;
  const [state] = (await ds.query(
    `SELECT current_user AS "current",
            (SELECT tableowner FROM pg_tables WHERE schemaname = $1 AND tablename = 'migrations') AS "owner",
            EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $2) AS "exists"`,
    [schema, role],
  )) as Array<{ current: string; owner: string | null; exists: boolean }>;
  // rol yo‘q; yoki servis roli CLI ning o‘zi / jadval egasi (umumiy foydalanuvchi) — egadan huquq olinmaydi;
  // jadval boshqa foydalanuvchiniki — REVOKE ni faqat egasi bajara oladi
  if (
    !state?.exists ||
    role === state.current ||
    role === state.owner ||
    state.owner !== state.current
  )
    return;
  await ds.query(
    `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "${schema}"."migrations" FROM "${role.replace(/"/g, '""')}"`,
  );
}

/**
 * Migratsiya CLI (BE-04, `DB_AUTO_MIGRATE=false` bo‘lganda deploy qadami):
 * - `run` — sxema yaratiladi (yo‘q bo‘lsa), hamma yangi migratsiya, har biri o‘z tranzaksiyasida;
 * - `revert` — oxirgi migratsiya qaytariladi;
 * - `show` — hali yurgizilmagan migratsiyalar;
 * - `check` — `run`, keyin `schemaDrift` (jadval, ustun, tur, NULL, sukut): farq bo‘lsa — chiqish kodi 1.
 * Qaytaradi: chiqish kodi.
 */
export async function runMigrationCli(
  def: DatabaseDefinition,
  args: string[],
  env: Env = process.env,
  log: (line: string) => void = console.log,
): Promise<number> {
  const command = args[0] as Command;
  if (!COMMANDS.includes(command)) {
    log(`foydalanish: migrate <${COMMANDS.join('|')}>`);
    return 2;
  }
  const ds = migrationDataSource(def, env);
  await ds.initialize();
  try {
    if (command === 'show') {
      const names = await pending(ds);
      log(
        names.length
          ? `${def.schema}: yurgizilmagan — ${names.join(', ')}`
          : `${def.schema}: hammasi yurgizilgan`,
      );
      return 0;
    }
    if (command === 'revert') {
      await ds.undoLastMigration({ transaction: 'each' });
      log(`${def.schema}: oxirgi migratsiya qaytarildi`);
      return 0;
    }
    // BE-36: migrator bazada CREATE huquqisiz — sxemani bootstrap yaratadi; `IF NOT EXISTS` ham huquqni tekshiradi
    const exists = (await ds.query(
      'SELECT 1 FROM pg_namespace WHERE nspname = $1',
      [def.schema],
    )) as unknown[];
    if (!exists.length)
      await ds.query(`CREATE SCHEMA IF NOT EXISTS "${def.schema}"`);
    const executed = await ds.runMigrations({ transaction: 'each' });
    await protectMigrationHistory(ds, def.schema, env);
    log(
      `${def.schema}: ${executed.length ? `yurgizildi — ${executed.map((m) => m.name).join(', ')}` : 'yangi migratsiya yo‘q'}`,
    );
    if (command === 'run') return 0;
    const problems = await schemaDrift(ds, def.schema);
    if (problems.length === 0) {
      log(
        `${def.schema}: entity’lar talab qiladigan hamma jadval va ustun migratsiyada bor`,
      );
      return 0;
    }
    log(`${def.schema}: sxema entity’lardan farq qiladi — migratsiya kerak:`);
    for (const problem of problems) log(`  ${problem}`);
    return 1;
  } finally {
    await ds.destroy();
  }
}
