import { MigrationInterface, QueryRunner } from 'typeorm';

/** C1.46 — do‘konning Elchi market tariflarini saqlash. */
export class AddShopTariffs1725372000000 implements MigrationInterface {
  name = 'AddShopTariffs1725372000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."shop"
       ADD COLUMN IF NOT EXISTS "tariff_home" numeric(14,2) NOT NULL DEFAULT 25000,
       ADD COLUMN IF NOT EXISTS "tariff_center" numeric(14,2) NOT NULL DEFAULT 15000`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."shop"
       DROP COLUMN IF EXISTS "tariff_center",
       DROP COLUMN IF EXISTS "tariff_home"`,
    );
  }
}
