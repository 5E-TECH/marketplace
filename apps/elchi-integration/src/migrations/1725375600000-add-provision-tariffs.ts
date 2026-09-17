import { MigrationInterface, QueryRunner } from 'typeorm';

/** C1.46 — retry Elchi'ga aynan approve paytidagi geo/tarifni qayta yuboradi. */
export class AddProvisionTariffs1725375600000 implements MigrationInterface {
  name = 'AddProvisionTariffs1725375600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "integration"."elchi_market_provision"
       ADD COLUMN IF NOT EXISTS "region_id" bigint,
       ADD COLUMN IF NOT EXISTS "district_id" bigint,
       ADD COLUMN IF NOT EXISTS "tariff_home" numeric(14,2) NOT NULL DEFAULT 0,
       ADD COLUMN IF NOT EXISTS "tariff_center" numeric(14,2) NOT NULL DEFAULT 0`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "integration"."elchi_market_provision"
       DROP COLUMN IF EXISTS "tariff_center",
       DROP COLUMN IF EXISTS "tariff_home",
       DROP COLUMN IF EXISTS "district_id",
       DROP COLUMN IF EXISTS "region_id"`,
    );
  }
}
