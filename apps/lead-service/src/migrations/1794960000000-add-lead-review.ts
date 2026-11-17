import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-12: tekshiruvga tushgan ariza (bot himoyasi). «Bir IP dan 10 daqiqada 5 tadan ortiq → tekshiruvga» (BE-12 kartasi).
 * Belgili lid navbatga chiqmaydi (BE-13), admin ko‘radi (BE-42, FE-26).
 */
export class AddLeadReview1794960000000 implements MigrationInterface {
  name = 'AddLeadReview1794960000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lead"."lead"
        ADD COLUMN "review_reason" VARCHAR(20),
        ADD CONSTRAINT "chk_lead_lead_review_reason"
          CHECK ("review_reason" IS NULL OR "review_reason" IN ('IP_RATE'))
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_ip_created" ON "lead"."lead" ("ip", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "lead"."idx_lead_lead_ip_created"`,
    );
    await queryRunner.query(`
      ALTER TABLE "lead"."lead"
        DROP CONSTRAINT IF EXISTS "chk_lead_lead_review_reason",
        DROP COLUMN IF EXISTS "review_reason"
    `);
  }
}
