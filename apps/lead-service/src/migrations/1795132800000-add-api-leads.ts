import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-43 (SOT-6): sotuvchining lid API si.
 * - affiliate_api_key.key_prefix — kabinetda kalitni tanish uchun (kalitning o‘zi saqlanmaydi, faqat xeshi);
 * - lead.api_key_id + lead.idempotency_key — bitta kalit va bitta Idempotency-Key bilan takror so‘rov o‘sha lidni qaytaradi.
 */
export class AddApiLeads1795132800000 implements MigrationInterface {
  name = 'AddApiLeads1795132800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lead"."affiliate_api_key"
        ADD COLUMN "key_prefix" VARCHAR(12) NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE "lead"."lead"
        ADD COLUMN "api_key_id" BIGINT,
        ADD COLUMN "idempotency_key" VARCHAR(100),
        ADD CONSTRAINT "fk_lead_lead_api_key"
          FOREIGN KEY ("api_key_id") REFERENCES "lead"."affiliate_api_key" ("id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_lead_lead_api_idempotency"
      ON "lead"."lead" ("api_key_id", "idempotency_key")
      WHERE "api_key_id" IS NOT NULL AND "idempotency_key" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "lead"."uq_lead_lead_api_idempotency"`,
    );
    await queryRunner.query(`
      ALTER TABLE "lead"."lead"
        DROP CONSTRAINT IF EXISTS "fk_lead_lead_api_key",
        DROP COLUMN IF EXISTS "idempotency_key",
        DROP COLUMN IF EXISTS "api_key_id"
    `);
    await queryRunner.query(
      `ALTER TABLE "lead"."affiliate_api_key" DROP COLUMN IF EXISTS "key_prefix"`,
    );
  }
}
