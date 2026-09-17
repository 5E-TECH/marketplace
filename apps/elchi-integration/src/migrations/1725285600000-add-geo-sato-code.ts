import { MigrationInterface, QueryRunner } from 'typeorm';

/** C1.44 — Elchi hududlari uchun SOATO/SATO kodini keshlash. */
export class AddGeoSatoCode1725285600000 implements MigrationInterface {
  name = 'AddGeoSatoCode1725285600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "integration"."geo_cache"
       ADD COLUMN IF NOT EXISTS "sato_code" VARCHAR(20)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_integration_geo_sato_code"
       ON "integration"."geo_cache" ("sato_code")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "integration"."idx_integration_geo_sato_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "integration"."geo_cache"
       DROP COLUMN IF EXISTS "sato_code"`,
    );
  }
}
