import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentTables1724241600000 implements MigrationInterface {
  name = 'CreatePaymentTables1724241600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment"."payment" (
        "id" BIGSERIAL PRIMARY KEY,
        "sales_order_id" BIGINT NOT NULL,
        "provider" VARCHAR(10) NOT NULL,
        "amount" NUMERIC(14,2) NOT NULL CHECK ("amount" > 0),
        "status" VARCHAR(15) NOT NULL DEFAULT 'CREATED',
        "external_txn_id" VARCHAR(255),
        "paid_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_payment_provider" CHECK ("provider" IN ('PAYME','CLICK')),
        CONSTRAINT "chk_payment_status" CHECK (
          "status" IN ('CREATED','PENDING','PAID','CANCELLED','FAILED','REFUNDED')
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_order_provider"
      ON "payment"."payment" ("sales_order_id", "provider")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment"."payment_transaction" (
        "id" BIGSERIAL PRIMARY KEY,
        "payment_id" BIGINT NOT NULL
          REFERENCES "payment"."payment"("id") ON DELETE CASCADE,
        "provider_txn_id" VARCHAR(255),
        "state" INTEGER,
        "action" VARCHAR(50),
        "amount" NUMERIC(14,2),
        "raw" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_transaction_payment"
      ON "payment"."payment_transaction" ("payment_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment"."provider_config" (
        "id" BIGSERIAL PRIMARY KEY,
        "provider" VARCHAR(10) NOT NULL UNIQUE,
        "merchant_id" VARCHAR(255),
        "secret_encrypted" TEXT,
        "base_url" VARCHAR(1000),
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_provider_config_provider"
          CHECK ("provider" IN ('PAYME','CLICK'))
      )
    `);
    // Old bootstrap SQL bilan yaratilgan jadvalni ham yangi entity bilan moslaydi.
    await queryRunner.query(`
      ALTER TABLE "payment"."provider_config"
      ADD COLUMN IF NOT EXISTS "base_url" VARCHAR(1000)
    `);
    await queryRunner.query(`
      ALTER TABLE "payment"."provider_config"
      ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payment"."provider_config"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "payment"."payment_transaction"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "payment"."payment"`);
  }
}
