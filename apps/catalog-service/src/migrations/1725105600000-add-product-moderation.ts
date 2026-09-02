import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductModeration1725105600000 implements MigrationInterface {
  name = 'AddProductModeration1725105600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."product"
       ADD COLUMN IF NOT EXISTS "is_blocked" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_catalog_product_is_blocked"
       ON "catalog"."product" ("is_blocked")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "catalog"."idx_catalog_product_is_blocked"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog"."product" DROP COLUMN IF EXISTS "is_blocked"`,
    );
  }
}
