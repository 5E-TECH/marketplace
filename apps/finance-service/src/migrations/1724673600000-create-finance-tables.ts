import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceTables1724673600000 implements MigrationInterface {
  name = 'CreateFinanceTables1724673600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "finance"."seller_ledger" (
        "id" BIGSERIAL PRIMARY KEY,
        "shop_id" BIGINT NOT NULL,
        "entry_type" VARCHAR(15) NOT NULL,
        "amount" NUMERIC(14,2) NOT NULL,
        "balance_after" NUMERIC(14,2) NOT NULL,
        "reference_type" VARCHAR(30) NOT NULL,
        "reference_id" VARCHAR(255) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_finance_ledger_type" CHECK
          ("entry_type" IN ('SALE','COMMISSION','PAYOUT','REFUND','ADJUST')),
        CONSTRAINT "uq_finance_ledger_reference"
          UNIQUE ("shop_id","entry_type","reference_type","reference_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_seller_ledger_shop_created"
      ON "finance"."seller_ledger" ("shop_id", "created_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "finance"."payout" (
        "id" BIGSERIAL PRIMARY KEY,
        "shop_id" BIGINT NOT NULL,
        "amount" NUMERIC(14,2) NOT NULL CHECK ("amount" >= 0),
        "status" VARCHAR(15) NOT NULL DEFAULT 'PENDING',
        "method" VARCHAR(30),
        "reference_id" VARCHAR(255) NOT NULL UNIQUE,
        "paid_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_finance_payout_status" CHECK
          ("status" IN ('PENDING','APPROVED','HELD','PAID'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_finance_payout_shop_status"
      ON "finance"."payout" ("shop_id", "status", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "finance"."commission" (
        "id" BIGSERIAL PRIMARY KEY,
        "shop_id" BIGINT,
        "category_id" BIGINT,
        "type" VARCHAR(10) NOT NULL DEFAULT 'PERCENT',
        "value" NUMERIC(14,2) NOT NULL CHECK ("value" >= 0),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_finance_commission_type"
          CHECK ("type" IN ('PERCENT','FIXED')),
        CONSTRAINT "chk_finance_commission_scope"
          CHECK (NOT ("shop_id" IS NOT NULL AND "category_id" IS NOT NULL))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_commission_global"
      ON "finance"."commission" ((1))
      WHERE "shop_id" IS NULL AND "category_id" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_commission_shop"
      ON "finance"."commission" ("shop_id") WHERE "shop_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_commission_category"
      ON "finance"."commission" ("category_id") WHERE "category_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "finance"."commission"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "finance"."payout"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "finance"."seller_ledger"`);
  }
}
