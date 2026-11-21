import { MigrationInterface, QueryRunner } from 'typeorm';

/** BE-21 (TZ ELC-4): kunlik COD sverkasi natijasi — sana bo‘yicha bitta. */
export class CreateCodDailyCheck1796601600000 implements MigrationInterface {
  name = 'CreateCodDailyCheck1796601600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "finance"."cod_daily_check" (
        "check_date" DATE PRIMARY KEY,
        "matched" INT NOT NULL,
        "partial" INT NOT NULL,
        "mismatch" INT NOT NULL,
        "pending" INT NOT NULL,
        "expected_total" BIGINT NOT NULL,
        "received_total" BIGINT NOT NULL,
        "mismatches" JSONB NOT NULL,
        "computed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "alerted_at" TIMESTAMPTZ
      )
    `);
    // kunlik oraliq so‘rovi (kelgan yoki holati o‘zgargan o‘tkazmalar)
    await q.query(
      'CREATE INDEX IF NOT EXISTS "idx_finance_remittance_created" ON "finance"."remittance_item" ("created_at")',
    );
    await q.query(
      'CREATE INDEX IF NOT EXISTS "idx_finance_remittance_updated" ON "finance"."remittance_item" ("updated_at")',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'DROP INDEX IF EXISTS "finance"."idx_finance_remittance_updated"',
    );
    await q.query(
      'DROP INDEX IF EXISTS "finance"."idx_finance_remittance_created"',
    );
    await q.query('DROP TABLE IF EXISTS "finance"."cod_daily_check"');
  }
}
