import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-08 (TZ T4, SOT-9): `catalog.creative` — mahsulot kreativlari (video, rasm). Fayl kaliti unikal (bitta fayl —
 * bitta kreativ); o‘chirilgan kreativ offerdan chiqadi.
 */
export class Creative1796515200000 implements MigrationInterface {
  name = 'Creative1796515200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "catalog"."creative" (
        "id" BIGSERIAL PRIMARY KEY,
        "product_id" BIGINT NOT NULL REFERENCES "catalog"."product"("id"),
        "type" VARCHAR(10) NOT NULL,
        "object_key" VARCHAR(300) NOT NULL,
        "url" VARCHAR(1000) NOT NULL,
        "mime_type" VARCHAR(100) NOT NULL,
        "size_bytes" BIGINT NOT NULL,
        "position" INTEGER NOT NULL DEFAULT 0,
        "created_by" BIGINT,
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_catalog_creative_object_key" UNIQUE ("object_key"),
        CONSTRAINT "chk_catalog_creative_type" CHECK ("type" IN ('IMAGE', 'VIDEO')),
        CONSTRAINT "chk_catalog_creative_size" CHECK ("size_bytes" > 0),
        CONSTRAINT "chk_catalog_creative_key"
          CHECK ("object_key" LIKE 'creatives/' || "product_id" || '/%')
      )
    `);
    await q.query(`
      CREATE INDEX "idx_catalog_creative_product"
      ON "catalog"."creative" ("product_id", "position", "id")
      WHERE "is_deleted" = FALSE
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "catalog"."creative"`);
  }
}
