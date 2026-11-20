import {
  Column,
  Entity,
  MigrationInterface,
  PrimaryGeneratedColumn,
  QueryRunner,
} from 'typeorm';
import { DataSource } from 'typeorm';
import { runMigrationCli, type DatabaseDefinition } from './migrate-cli';

/** BE-04: migratsiya CLI va sxema tekshiruvi haqiqiy PostgreSQL da (CI: TEST_DATABASE_URL). */
const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
const SCHEMA = 'be04_migrate_cli_test';

@Entity({ schema: SCHEMA, name: 'item' })
class Item {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 20 }) name: string;
  @Column({ type: 'integer', nullable: true }) qty: number | null;
  @Column({ type: 'varchar', length: 10, default: 'ACTIVE' }) status: string;
}

class CreateItem1700000000001 implements MigrationInterface {
  name = 'CreateItem1700000000001';
  async up(q: QueryRunner) {
    await q.query(
      `CREATE TABLE "${SCHEMA}"."item" ("id" SERIAL PRIMARY KEY, "name" varchar(20) NOT NULL, "status" varchar(10) NOT NULL DEFAULT 'active')`,
    );
  }
  async down(q: QueryRunner) {
    await q.query(`DROP TABLE "${SCHEMA}"."item"`);
  }
}
class AddQtyNotNull1700000000002 implements MigrationInterface {
  name = 'AddQtyNotNull1700000000002';
  async up(q: QueryRunner) {
    await q.query(
      `ALTER TABLE "${SCHEMA}"."item" ADD COLUMN "qty" integer NOT NULL DEFAULT 0`,
    );
  }
  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE "${SCHEMA}"."item" DROP COLUMN "qty"`);
  }
}
class QtyNullable1700000000003 implements MigrationInterface {
  name = 'QtyNullable1700000000003';
  async up(q: QueryRunner) {
    await q.query(
      `ALTER TABLE "${SCHEMA}"."item" ALTER COLUMN "qty" DROP NOT NULL`,
    );
  }
  async down(q: QueryRunner) {
    await q.query(
      `ALTER TABLE "${SCHEMA}"."item" ALTER COLUMN "qty" SET NOT NULL`,
    );
  }
}

class StatusDefault1700000000004 implements MigrationInterface {
  name = 'StatusDefault1700000000004';
  async up(q: QueryRunner) {
    await q.query(
      `ALTER TABLE "${SCHEMA}"."item" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'`,
    );
  }
  async down(q: QueryRunner) {
    await q.query(
      `ALTER TABLE "${SCHEMA}"."item" ALTER COLUMN "status" SET DEFAULT 'active'`,
    );
  }
}

const UP_TO_QTY = [
  CreateItem1700000000001,
  AddQtyNotNull1700000000002,
  QtyNullable1700000000003,
];
const ALL = [...UP_TO_QTY, StatusDefault1700000000004];

const def = (
  migrations: DatabaseDefinition['migrations'],
): DatabaseDefinition => ({ schema: SCHEMA, entities: [Item], migrations });

describeWithPostgres('BE-04 migratsiya CLI (PostgreSQL)', () => {
  const env = { MIGRATE_DATABASE_URL: url };
  let admin: DataSource;
  const run = async (
    migrations: DatabaseDefinition['migrations'],
    command: string,
  ) => {
    const lines: string[] = [];
    const code = await runMigrationCli(
      def(migrations),
      [command],
      env,
      (line) => lines.push(line),
    );
    return { code, out: lines.join('\n') };
  };

  beforeAll(async () => {
    admin = await new DataSource({ type: 'postgres', url }).initialize();
    await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  });
  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin.destroy();
  });

  it('TC2/TC3: check — ustun yo‘q, NULL yoki sukut farq qilsa 1, mos bo‘lsa 0; show va revert', async () => {
    const missing = await run([CreateItem1700000000001], 'check');
    expect(missing.code).toBe(1);
    expect(missing.out).toContain(`ustun yo‘q: ${SCHEMA}.item.qty`);

    const notNull = await run(
      [CreateItem1700000000001, AddQtyNotNull1700000000002],
      'check',
    );
    expect(notNull.code).toBe(1);
    expect(notNull.out).toContain(
      `NULL farq qiladi: ${SCHEMA}.item.qty — entity NULL mumkin, bazada NOT NULL`,
    );

    // catalog’dagi 'active' / 'ACTIVE' kabi: ustun bor, turi va NULL mos, sukuti boshqa
    const wrongDefault = await run(UP_TO_QTY, 'check');
    expect(wrongDefault.code).toBe(1);
    expect(wrongDefault.out).toContain(
      `sukut farq qiladi (entity ACTIVE, bazada active): ${SCHEMA}.item.status`,
    );

    expect((await run(ALL, 'show')).out).toContain(
      'yurgizilmagan — StatusDefault1700000000004',
    );
    const ok = await run(ALL, 'check');
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('hamma jadval va ustun migratsiyada bor');
    expect((await run(ALL, 'show')).out).toContain('hammasi yurgizilgan');

    expect((await run(ALL, 'revert')).code).toBe(0);
    expect((await run(ALL, 'show')).out).toContain(
      'yurgizilmagan — StatusDefault1700000000004',
    );
  });

  it('noma’lum buyruq — 2, ulanish ochilmaydi', async () => {
    expect((await run([CreateItem1700000000001], 'drop')).code).toBe(2);
  });
});
