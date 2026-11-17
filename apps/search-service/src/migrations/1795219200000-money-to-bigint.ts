import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-01 (TZ T9-1, T8 «Pul»): pul ustunlari NUMERIC(14,2) → BIGINT, butun so‘m.
 * Baza toza boshlanadi (1-bo‘lim, 3-qaror); mavjud qatorlar `round()` bilan butun so‘mga o‘tadi.
 */
export class MoneyToBigint1795219200000 implements MigrationInterface {
  name = 'MoneyToBigint1795219200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "search"."search_document"
        ALTER COLUMN "price" TYPE BIGINT USING round("price")::bigint
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "search"."search_document"
        ALTER COLUMN "price" TYPE NUMERIC(14,2) USING "price"::numeric
    `);
  }
}
