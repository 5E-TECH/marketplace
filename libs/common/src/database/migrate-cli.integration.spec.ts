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
}

class CreateItem1700000000001 implements MigrationInterface {
  name = 'CreateItem1700000000001';
  async up(q: QueryRunner) {
    await q.query(
      `CREATE TABLE "${SCHEMA}"."item" ("id" SERIAL PRIMARY KEY, "name" varchar(20) NOT NULL)`,
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

  it('TC2/TC3: check — entity ustuni migratsiyada yo‘q yoki NULL farq qilsa 1, mos bo‘lsa 0; show va revert', async () => {
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

    expect(
      (
        await run(
          [
            CreateItem1700000000001,
            AddQtyNotNull1700000000002,
            QtyNullable1700000000003,
          ],
          'show',
        )
      ).out,
    ).toContain('yurgizilmagan — QtyNullable1700000000003');
    const ok = await run(
      [
        CreateItem1700000000001,
        AddQtyNotNull1700000000002,
        QtyNullable1700000000003,
      ],
      'check',
    );
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('hamma jadval va ustun migratsiyada bor');
    expect(
      (
        await run(
          [
            CreateItem1700000000001,
            AddQtyNotNull1700000000002,
            QtyNullable1700000000003,
          ],
          'show',
        )
      ).out,
    ).toContain('hammasi yurgizilgan');

    expect(
      (
        await run(
          [
            CreateItem1700000000001,
            AddQtyNotNull1700000000002,
            QtyNullable1700000000003,
          ],
          'revert',
        )
      ).code,
    ).toBe(0);
    expect(
      (
        await run(
          [
            CreateItem1700000000001,
            AddQtyNotNull1700000000002,
            QtyNullable1700000000003,
          ],
          'show',
        )
      ).out,
    ).toContain('yurgizilmagan — QtyNullable1700000000003');
  });

  it('noma’lum buyruq — 2, ulanish ochilmaydi', async () => {
    expect((await run([CreateItem1700000000001], 'drop')).code).toBe(2);
  });
});
