import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-34: saytdan buyurtma (TZ SAYT-1, SAYT-2; ega qarori 2026-11-10).
 * - `lead_item` — ko‘p tovarli lid qatorlari.
 * - `lead.confirm_mode` — CALL (operator qo‘ng‘iroq qiladi) yoki SMS (mijoz havola bilan tasdiqlaydi; faqat SITE).
 * - `lead.confirmed_via` — kim tasdiqladi: OPERATOR yoki SMS.
 * - `lead.sms_token_hash`, `lead.sms_expires_at` — bir martalik tasdiq havolasi (bazada faqat xeshi).
 */
export class SiteOrder1798070400000 implements MigrationInterface {
  name = 'SiteOrder1798070400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "lead"."lead_item" (
        "id" BIGSERIAL PRIMARY KEY,
        "lead_id" BIGINT NOT NULL REFERENCES "lead"."lead"("id"),
        "position" INT NOT NULL,
        "product_id" BIGINT NOT NULL,
        "product_name" VARCHAR(255) NOT NULL,
        "quantity" INT NOT NULL,
        "sale_price" BIGINT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_lead_lead_item_quantity" CHECK ("quantity" BETWEEN 1 AND 1000),
        CONSTRAINT "chk_lead_lead_item_price" CHECK ("sale_price" > 0),
        CONSTRAINT "chk_lead_lead_item_position" CHECK ("position" >= 0)
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX "uq_lead_lead_item_product" ON "lead"."lead_item" ("lead_id", "product_id")`,
    );
    await q.query(`
      ALTER TABLE "lead"."lead"
        ADD COLUMN "confirm_mode" VARCHAR(4) NOT NULL DEFAULT 'CALL',
        ADD COLUMN "confirmed_via" VARCHAR(10),
        ADD COLUMN "sms_token_hash" VARCHAR(64),
        ADD COLUMN "sms_expires_at" TIMESTAMPTZ,
        ADD CONSTRAINT "chk_lead_lead_confirm_mode" CHECK (
          "confirm_mode" = 'CALL' OR ("confirm_mode" = 'SMS' AND "source" = 'SITE')
        ),
        ADD CONSTRAINT "chk_lead_lead_confirmed_via"
          CHECK ("confirmed_via" IS NULL OR "confirmed_via" IN ('OPERATOR', 'SMS'))
    `);
    await q.query(
      `CREATE UNIQUE INDEX "uq_lead_lead_sms_token" ON "lead"."lead" ("sms_token_hash") WHERE "sms_token_hash" IS NOT NULL`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "lead"."uq_lead_lead_sms_token"`);
    await q.query(`
      ALTER TABLE "lead"."lead"
        DROP CONSTRAINT IF EXISTS "chk_lead_lead_confirmed_via",
        DROP CONSTRAINT IF EXISTS "chk_lead_lead_confirm_mode",
        DROP COLUMN IF EXISTS "sms_expires_at",
        DROP COLUMN IF EXISTS "sms_token_hash",
        DROP COLUMN IF EXISTS "confirmed_via",
        DROP COLUMN IF EXISTS "confirm_mode"
    `);
    await q.query(`DROP TABLE IF EXISTS "lead"."lead_item"`);
  }
}
