import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShopFeatured1725192000000 implements MigrationInterface {
  name = 'AddShopFeatured1725192000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."shop"
       ADD COLUMN IF NOT EXISTS "is_featured" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_catalog_shop_featured_active"
       ON "catalog"."shop" ("is_featured")
       WHERE "is_deleted" = false AND "status" = 'ACTIVE'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "catalog"."idx_catalog_shop_featured_active"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog"."shop" DROP COLUMN IF EXISTS "is_featured"`,
    );
  }
}
