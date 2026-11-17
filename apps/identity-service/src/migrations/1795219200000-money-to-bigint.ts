import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-01 (TZ T9-1, T8 «Pul»): pul ustunlari NUMERIC(14,2) → BIGINT, butun so‘m.
 * Baza toza boshlanadi (1-bo‘lim, 3-qaror); mavjud qatorlar `round()` bilan butun so‘mga o‘tadi.
 */
export class MoneyToBigint1795219200000 implements MigrationInterface {
  name = 'MoneyToBigint1795219200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "identity"."platform_settings"
        ALTER COLUMN "minimum_order_amount" TYPE BIGINT USING round("minimum_order_amount")::bigint
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "identity"."platform_settings"
        ALTER COLUMN "minimum_order_amount" TYPE NUMERIC(14,2) USING "minimum_order_amount"::numeric
    `);
  }
}
