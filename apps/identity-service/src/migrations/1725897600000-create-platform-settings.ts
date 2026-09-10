import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformSettings1725897600000 implements MigrationInterface {
  name = 'CreatePlatformSettings1725897600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "identity"."platform_settings" (
        "id" SMALLINT NOT NULL DEFAULT 1,
        "commission_percent" NUMERIC(5,2) NOT NULL DEFAULT 0,
        "minimum_order_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "support_phone" VARCHAR(13) NOT NULL DEFAULT '',
        "updated_by" BIGINT,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_identity_platform_settings" PRIMARY KEY ("id"),
        CONSTRAINT "chk_identity_platform_settings_singleton" CHECK ("id" = 1),
        CONSTRAINT "chk_identity_platform_settings_commission" CHECK ("commission_percent" BETWEEN 0 AND 100),
        CONSTRAINT "chk_identity_platform_settings_min_order" CHECK ("minimum_order_amount" >= 0),
        CONSTRAINT "chk_identity_platform_settings_phone" CHECK ("support_phone" = '' OR "support_phone" ~ '^\\+998[0-9]{9}$')
      )
    `);
    await queryRunner.query(`
      INSERT INTO "identity"."platform_settings" ("id") VALUES (1)
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "identity"."platform_settings"`,
    );
  }
}
