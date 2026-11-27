import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-45 (OPR-4, OPR-7): operator tasdiqlash qo‘ng‘irog‘ida qo‘shgan qo‘shimcha tovar (upsell) — `lead_item` qatori
 * belgisi, kim va qachon qo‘shgani. Upsell foizi shu belgidan hisoblanadi.
 */
export class LeadUpsell1799366400000 implements MigrationInterface {
  name = 'LeadUpsell1799366400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "lead"."lead_item"
        ADD COLUMN "is_upsell" BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN "added_by" BIGINT,
        ADD COLUMN "added_at" TIMESTAMPTZ
    `);
    await q.query(`
      CREATE INDEX "idx_lead_lead_item_upsell" ON "lead"."lead_item" ("lead_id") WHERE "is_upsell"
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "lead"."idx_lead_lead_item_upsell"`);
    await q.query(`
      ALTER TABLE "lead"."lead_item"
        DROP COLUMN "added_at",
        DROP COLUMN "added_by",
        DROP COLUMN "is_upsell"
    `);
  }
}
