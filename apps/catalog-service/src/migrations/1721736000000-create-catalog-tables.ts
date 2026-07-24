import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCatalogTables1721736000000 implements MigrationInterface {
  name = 'CreateCatalogTables1721736000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "catalog"."shop" (
        "id" BIGSERIAL NOT NULL,
        "owner_user_id" BIGINT NOT NULL,
        "name" VARCHAR(255) NOT NULL,
        "slug" VARCHAR(255) NOT NULL,
        "description" TEXT,
        "logo_url" VARCHAR(500),
        "banner_url" VARCHAR(500),
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "phone" VARCHAR(20),
        "region_id" BIGINT,
        "district_id" BIGINT,
        "address" TEXT,
        "rating" NUMERIC(3,2) NOT NULL DEFAULT 0,
        "orders_count" INTEGER NOT NULL DEFAULT 0,
        "elchi_market_id" BIGINT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_catalog_shop" PRIMARY KEY ("id"),
        CONSTRAINT "uq_catalog_shop_owner_user_id" UNIQUE ("owner_user_id"),
        CONSTRAINT "uq_catalog_shop_slug" UNIQUE ("slug"),
        CONSTRAINT "chk_catalog_shop_status"
          CHECK ("status" IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED')),
        CONSTRAINT "chk_catalog_shop_rating"
          CHECK ("rating" >= 0 AND "rating" <= 5),
        CONSTRAINT "chk_catalog_shop_orders_count" CHECK ("orders_count" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "catalog"."category" (
        "id" BIGSERIAL NOT NULL,
        "name" VARCHAR(255) NOT NULL,
        "slug" VARCHAR(255) NOT NULL,
        "parent_id" BIGINT,
        "icon_url" VARCHAR(500),
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_catalog_category" PRIMARY KEY ("id"),
        CONSTRAINT "uq_catalog_category_slug" UNIQUE ("slug"),
        CONSTRAINT "fk_catalog_category_parent"
          FOREIGN KEY ("parent_id") REFERENCES "catalog"."category"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_catalog_category_parent_id"
      ON "catalog"."category" ("parent_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "catalog"."product" (
        "id" BIGSERIAL NOT NULL,
        "shop_id" BIGINT NOT NULL,
        "owner_user_id" BIGINT NOT NULL,
        "category_id" BIGINT,
        "name" VARCHAR(255) NOT NULL,
        "slug" VARCHAR(255) NOT NULL,
        "description" TEXT,
        "price" NUMERIC(14,2) NOT NULL,
        "old_price" NUMERIC(14,2),
        "image_url" VARCHAR(500),
        "images" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "attributes" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "has_variants" BOOLEAN NOT NULL DEFAULT FALSE,
        "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_catalog_product" PRIMARY KEY ("id"),
        CONSTRAINT "uq_catalog_product_shop_slug" UNIQUE ("shop_id", "slug"),
        CONSTRAINT "fk_catalog_product_shop"
          FOREIGN KEY ("shop_id") REFERENCES "catalog"."shop"("id")
          ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "fk_catalog_product_category"
          FOREIGN KEY ("category_id") REFERENCES "catalog"."category"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "chk_catalog_product_status"
          CHECK ("status" IN ('DRAFT', 'ACTIVE', 'ARCHIVED', 'OUT_OF_STOCK')),
        CONSTRAINT "chk_catalog_product_price" CHECK ("price" >= 0),
        CONSTRAINT "chk_catalog_product_old_price"
          CHECK ("old_price" IS NULL OR "old_price" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_catalog_product_category_id"
      ON "catalog"."product" ("category_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "catalog"."product_variant" (
        "id" BIGSERIAL NOT NULL,
        "product_id" BIGINT NOT NULL,
        "sku" VARCHAR(100) NOT NULL,
        "name" VARCHAR(255),
        "attributes" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "price" NUMERIC(14,2),
        "old_price" NUMERIC(14,2),
        "barcode" VARCHAR(100),
        "image_url" VARCHAR(500),
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_catalog_product_variant" PRIMARY KEY ("id"),
        CONSTRAINT "uq_catalog_product_variant_sku" UNIQUE ("sku"),
        CONSTRAINT "fk_catalog_product_variant_product"
          FOREIGN KEY ("product_id") REFERENCES "catalog"."product"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "chk_catalog_product_variant_price"
          CHECK ("price" IS NULL OR "price" >= 0),
        CONSTRAINT "chk_catalog_product_variant_old_price"
          CHECK ("old_price" IS NULL OR "old_price" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_catalog_product_variant_product_id"
      ON "catalog"."product_variant" ("product_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "catalog"."product_variant"`);
    await queryRunner.query(`DROP TABLE "catalog"."product"`);
    await queryRunner.query(`DROP TABLE "catalog"."category"`);
    await queryRunner.query(`DROP TABLE "catalog"."shop"`);
  }
}
