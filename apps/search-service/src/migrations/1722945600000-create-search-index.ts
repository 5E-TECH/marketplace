import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSearchIndex1722945600000 implements MigrationInterface {
  name = 'CreateSearchIndex1722945600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "search"."search_document" (
        "id" BIGSERIAL PRIMARY KEY,
        "product_id" BIGINT NOT NULL,
        "shop_id" BIGINT NOT NULL,
        "category_id" BIGINT,
        "title" VARCHAR(255) NOT NULL,
        "content" TEXT,
        "slug" VARCHAR(255) NOT NULL,
        "image_url" VARCHAR(500),
        "shop_name" VARCHAR(255) NOT NULL,
        "price" NUMERIC(14,2) NOT NULL,
        "attributes" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_search_document_product_id" UNIQUE ("product_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_search_document_full_text"
      ON "search"."search_document" USING GIN (
        to_tsvector('simple', "title" || ' ' || COALESCE("content", ''))
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_search_document_category_id"
      ON "search"."search_document" ("category_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_search_document_price"
      ON "search"."search_document" ("price")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "search"."search_document"`);
  }
}
