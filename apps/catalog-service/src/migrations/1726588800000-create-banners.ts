import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBanners1726588800000 implements MigrationInterface {
  name = 'CreateBanners1726588800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "catalog"."banner" (
         "id"         BIGSERIAL PRIMARY KEY,
         "title"      VARCHAR(255)  NOT NULL,
         "image_url"  VARCHAR(1000) NOT NULL,
         "link_url"   VARCHAR(1000),
         "sort_order" INTEGER       NOT NULL DEFAULT 0,
         "is_active"  BOOLEAN       NOT NULL DEFAULT true,
         "starts_at"  TIMESTAMPTZ,
         "ends_at"    TIMESTAMPTZ,
         "created_at" TIMESTAMPTZ   NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMPTZ   NOT NULL DEFAULT now(),
         CONSTRAINT "chk_catalog_banner_period"
           CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at")
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_catalog_banner_sort"
       ON "catalog"."banner" ("sort_order", "id")`,
    );
    // Storefront har so'rovda faqat ko'rinadiganlarini o'qiydi.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_catalog_banner_visible"
       ON "catalog"."banner" ("sort_order", "id")
       WHERE "is_active" = true`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "catalog"."idx_catalog_banner_visible"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "catalog"."idx_catalog_banner_sort"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "catalog"."banner"`);
  }
}
