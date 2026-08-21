import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymeTransactionState1724328000000 implements MigrationInterface {
  name = 'AddPaymeTransactionState1724328000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment"."payment_transaction"
        ADD COLUMN IF NOT EXISTS "create_time" BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "perform_time" BIGINT,
        ADD COLUMN IF NOT EXISTS "cancel_time" BIGINT,
        ADD COLUMN IF NOT EXISTS "reason" INTEGER
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_transaction_provider_txn"
      ON "payment"."payment_transaction" ("provider_txn_id")
      WHERE "provider_txn_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "payment"."uq_payment_transaction_provider_txn"`,
    );
    await queryRunner.query(`
      ALTER TABLE "payment"."payment_transaction"
        DROP COLUMN IF EXISTS "reason",
        DROP COLUMN IF EXISTS "cancel_time",
        DROP COLUMN IF EXISTS "perform_time",
        DROP COLUMN IF EXISTS "create_time"
    `);
  }
}
