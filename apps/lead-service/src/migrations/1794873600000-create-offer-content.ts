import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-11: offer matnlari — suhbat skripti (OPR-2), afzalliklar va qutida (ega qarori 2026-11-17).
 * Mahsulot katalogda (BE-07); bu yerda faqat lid-sotuv matnlari, `product_id` FK siz (ADR 0001).
 */
export class CreateOfferContent1794873600000 implements MigrationInterface {
  name = 'CreateOfferContent1794873600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "lead"."offer_content" (
        "id" BIGSERIAL NOT NULL,
        "product_id" BIGINT NOT NULL,
        "call_script" TEXT,
        "highlights" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "box_contents" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "updated_by" BIGINT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_lead_offer_content" PRIMARY KEY ("id"),
        CONSTRAINT "uq_lead_offer_content_product" UNIQUE ("product_id"),
        CONSTRAINT "chk_lead_offer_content_highlights"
          CHECK (jsonb_typeof("highlights") = 'array'),
        CONSTRAINT "chk_lead_offer_content_box"
          CHECK (jsonb_typeof("box_contents") = 'array')
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lead"."offer_content"`);
  }
}
