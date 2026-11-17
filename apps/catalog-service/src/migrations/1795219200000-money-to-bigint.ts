import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-01 (TZ T9-1, T8 «Pul»): pul ustunlari NUMERIC(14,2) → BIGINT, butun so‘m.
 * Baza toza boshlanadi (1-bo‘lim, 3-qaror); mavjud qatorlar `round()` bilan butun so‘mga o‘tadi.
 */
export class MoneyToBigint1795219200000 implements MigrationInterface {
  name = 'MoneyToBigint1795219200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "catalog"."product"
        ALTER COLUMN "price" TYPE BIGINT USING round("price")::bigint,
        ALTER COLUMN "old_price" TYPE BIGINT USING round("old_price")::bigint
    `);
    await queryRunner.query(`
      ALTER TABLE "catalog"."product_variant"
        ALTER COLUMN "price" TYPE BIGINT USING round("price")::bigint,
        ALTER COLUMN "old_price" TYPE BIGINT USING round("old_price")::bigint
    `);
    await queryRunner.query(`
      ALTER TABLE "catalog"."shop"
        ALTER COLUMN "tariff_home" TYPE BIGINT USING round("tariff_home")::bigint,
        ALTER COLUMN "tariff_center" TYPE BIGINT USING round("tariff_center")::bigint
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "catalog"."product"
        ALTER COLUMN "price" TYPE NUMERIC(14,2) USING "price"::numeric,
        ALTER COLUMN "old_price" TYPE NUMERIC(14,2) USING "old_price"::numeric
    `);
    await queryRunner.query(`
      ALTER TABLE "catalog"."product_variant"
        ALTER COLUMN "price" TYPE NUMERIC(14,2) USING "price"::numeric,
        ALTER COLUMN "old_price" TYPE NUMERIC(14,2) USING "old_price"::numeric
    `);
    await queryRunner.query(`
      ALTER TABLE "catalog"."shop"
        ALTER COLUMN "tariff_home" TYPE NUMERIC(14,2) USING "tariff_home"::numeric,
        ALTER COLUMN "tariff_center" TYPE NUMERIC(14,2) USING "tariff_center"::numeric
    `);
  }
}
