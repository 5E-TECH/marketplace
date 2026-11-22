import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-30 (OPT-1, OPT-2): optovik o‘zi ro‘yxatdan o‘tadi — qabul qilingan elektron shartnoma versiyasi va vaqti,
 * ro‘yxatni rad etish izohi; yopiq hujjatlar (KYC, mahsulot sertifikati) — fayl yopiq saqlashda, bu yerda kaliti.
 */
export class WholesalerCabinet1798329600000 implements MigrationInterface {
  name = 'WholesalerCabinet1798329600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "catalog"."shop"
      ADD COLUMN "contract_version" VARCHAR(20),
      ADD COLUMN "contract_accepted_at" TIMESTAMPTZ,
      ADD COLUMN "moderation_note" TEXT`);
    await q.query(`
      CREATE TABLE "catalog"."wholesaler_document" (
        "id" BIGSERIAL PRIMARY KEY,
        "shop_id" BIGINT NOT NULL REFERENCES "catalog"."shop"("id"),
        "kind" VARCHAR(20) NOT NULL,
        "product_id" BIGINT REFERENCES "catalog"."product"("id"),
        "object_key" VARCHAR(300) NOT NULL,
        "file_name" VARCHAR(200) NOT NULL,
        "content_type" VARCHAR(40) NOT NULL,
        "size_bytes" INTEGER NOT NULL,
        "created_by" BIGINT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_catalog_wholesaler_document_key" UNIQUE ("object_key"),
        CONSTRAINT "chk_catalog_wholesaler_document_kind" CHECK ("kind" IN ('KYC', 'CERTIFICATE')),
        CONSTRAINT "chk_catalog_wholesaler_document_product"
          CHECK (("kind" = 'CERTIFICATE') = ("product_id" IS NOT NULL)),
        CONSTRAINT "chk_catalog_wholesaler_document_size" CHECK ("size_bytes" > 0)
      )`);
    await q.query(
      `CREATE INDEX "idx_catalog_wholesaler_document_shop" ON "catalog"."wholesaler_document" ("shop_id", "id" DESC)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "catalog"."wholesaler_document"`);
    await q.query(`ALTER TABLE "catalog"."shop"
      DROP COLUMN "moderation_note",
      DROP COLUMN "contract_accepted_at",
      DROP COLUMN "contract_version"`);
  }
}
