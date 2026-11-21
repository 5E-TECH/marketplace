import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-46 (FE-24, OPT-3, DZ-08 «Aktni qabul qilish» · «E’tiroz bildirish»): optovikning akt-sverkaga javobi.
 * - wholesaler_settlement.accepted_* — optovik aktni qabul qildi (bir marta);
 * - settlement_dispute — e’tiroz va moliya javobi; bitta aktda bir vaqtda bitta ochiq e’tiroz.
 * To‘lov qabulni kutmaydi [taklif, BE-46 savol 4] — akt holatiga (READY → … → PAID) ta’sir qilmaydi.
 */
export class CreateSettlementResponse1796947200000 implements MigrationInterface {
  name = 'CreateSettlementResponse1796947200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance"."wholesaler_settlement"
        ADD COLUMN "accepted_by" VARCHAR(64),
        ADD COLUMN "accepted_at" TIMESTAMPTZ,
        ADD CONSTRAINT "chk_finance_settlement_accepted"
          CHECK (("accepted_at" IS NULL) = ("accepted_by" IS NULL))
    `);
    await queryRunner.query(`
      CREATE TABLE "finance"."settlement_dispute" (
        "id" BIGSERIAL PRIMARY KEY,
        "settlement_id" BIGINT NOT NULL REFERENCES "finance"."wholesaler_settlement"("id"),
        "wholesaler_id" VARCHAR(64) NOT NULL,
        "comment" VARCHAR(2000) NOT NULL,
        "created_by" VARCHAR(64) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
        "answer" VARCHAR(2000),
        "answered_by" VARCHAR(64),
        "answered_at" TIMESTAMPTZ,
        CONSTRAINT "chk_finance_dispute_status" CHECK ("status" IN ('OPEN','ANSWERED')),
        CONSTRAINT "chk_finance_dispute_answer" CHECK (
          ("status" = 'ANSWERED') = ("answer" IS NOT NULL)
          AND ("answer" IS NULL) = ("answered_by" IS NULL)
          AND ("answer" IS NULL) = ("answered_at" IS NULL))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_finance_dispute_settlement" ON "finance"."settlement_dispute" ("settlement_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_finance_dispute_open" ON "finance"."settlement_dispute" ("settlement_id") WHERE "status" = 'OPEN'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "finance"."settlement_dispute"`,
    );
    await queryRunner.query(`
      ALTER TABLE "finance"."wholesaler_settlement"
        DROP CONSTRAINT IF EXISTS "chk_finance_settlement_accepted",
        DROP COLUMN IF EXISTS "accepted_at",
        DROP COLUMN IF EXISTS "accepted_by"
    `);
  }
}
