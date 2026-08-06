import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * C1.38 — Market operator: users jadvaliga `shop_id` (operator qaysi do'konga
 * biriktirilgan) + role CHECK'ga 'OPERATOR' qo'shiladi. Additive.
 */
export class AddUserShopOperator1722950000000 implements MigrationInterface {
  name = 'AddUserShopOperator1722950000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "shop_id" BIGINT`,
    );
    await queryRunner.query(
      `ALTER TABLE "identity"."users" DROP CONSTRAINT IF EXISTS "chk_identity_users_role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "identity"."users" ADD CONSTRAINT "chk_identity_users_role"
        CHECK ("role" IN ('BUYER', 'SELLER', 'OPERATOR', 'ADMIN', 'SUPERADMIN'))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_identity_users_shop" ON "identity"."users" ("shop_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "identity"."idx_identity_users_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "identity"."users" DROP CONSTRAINT IF EXISTS "chk_identity_users_role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "identity"."users" ADD CONSTRAINT "chk_identity_users_role"
        CHECK ("role" IN ('BUYER', 'SELLER', 'ADMIN', 'SUPERADMIN'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "identity"."users" DROP COLUMN IF EXISTS "shop_id"`,
    );
  }
}
