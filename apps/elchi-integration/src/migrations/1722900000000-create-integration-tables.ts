import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Elchi-integration (C1.6) jadvallari — `integration` schema:
 *  - elchi_market_provision: shop → Elchi market provisioning holati (idempotent+retry)
 *  - geo_cache: Elchi viloyat/tuman keshi
 */
export class CreateIntegrationTables1722900000000 implements MigrationInterface {
  name = 'CreateIntegrationTables1722900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "integration"."elchi_market_provision" (
        "id" BIGSERIAL NOT NULL,
        "shop_id" BIGINT NOT NULL,
        "elchi_market_id" BIGINT,
        "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
        "shop_name" VARCHAR(255),
        "phone" VARCHAR(30),
        "retry_count" INTEGER NOT NULL DEFAULT 0,
        "last_error" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_integration_market_provision" PRIMARY KEY ("id"),
        CONSTRAINT "uq_integration_market_provision_shop" UNIQUE ("shop_id"),
        CONSTRAINT "chk_integration_market_provision_status"
          CHECK ("status" IN ('pending', 'done', 'failed'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_integration_market_provision_status"
      ON "integration"."elchi_market_provision" ("status")
    `);

    await queryRunner.query(`
      CREATE TABLE "integration"."geo_cache" (
        "id" BIGSERIAL NOT NULL,
        "kind" VARCHAR(10) NOT NULL,
        "elchi_id" BIGINT NOT NULL,
        "name" VARCHAR(255) NOT NULL,
        "elchi_region_id" BIGINT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_integration_geo_cache" PRIMARY KEY ("id"),
        CONSTRAINT "uq_integration_geo_kind_elchi" UNIQUE ("kind", "elchi_id"),
        CONSTRAINT "chk_integration_geo_kind"
          CHECK ("kind" IN ('region', 'district'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_integration_geo_region"
      ON "integration"."geo_cache" ("elchi_region_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "integration"."geo_cache"`);
    await queryRunner.query(
      `DROP TABLE "integration"."elchi_market_provision"`,
    );
  }
}
