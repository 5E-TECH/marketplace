import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-46 (FE-19 TC2, DZ-07 «Hal qilindi deb yopish»): Elchi sverkasi farqini izoh bilan yopish.
 * Pul harakati yo‘q — yozuvlar HOLD da qoladi [taklif, BE-46 savol 2]. Kim, qachon, nima uchun — shu qatorning o‘zida
 * (TZ 3: pul o‘zgarishi audit jurnaliga). Kun bo‘yicha ro‘yxat uchun `created_at` indeksi.
 */
export class AddRemittanceResolution1796860800000 implements MigrationInterface {
  name = 'AddRemittanceResolution1796860800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance"."remittance_item"
        ADD COLUMN "resolution_comment" VARCHAR(1000),
        ADD COLUMN "resolved_by" VARCHAR(64),
        ADD COLUMN "resolved_at" TIMESTAMPTZ,
        ADD CONSTRAINT "chk_finance_remittance_resolution" CHECK (
          ("resolved_at" IS NULL) = ("resolved_by" IS NULL)
          AND ("resolved_at" IS NULL) = ("resolution_comment" IS NULL))
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_finance_remittance_created" ON "finance"."remittance_item" ("created_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "finance"."idx_finance_remittance_created"`,
    );
    await queryRunner.query(`
      ALTER TABLE "finance"."remittance_item"
        DROP CONSTRAINT IF EXISTS "chk_finance_remittance_resolution",
        DROP COLUMN IF EXISTS "resolved_at",
        DROP COLUMN IF EXISTS "resolved_by",
        DROP COLUMN IF EXISTS "resolution_comment"
    `);
  }
}
