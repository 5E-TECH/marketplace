import { MigrationInterface, QueryRunner } from 'typeorm';

/** BE-25 (FE-13, NRX-5): bozor narxi qayerda va qachon ko‘rilgani. */
export class ProductMarketSource1798588800000 implements MigrationInterface {
  name = 'ProductMarketSource1798588800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "catalog"."product"
        ADD COLUMN "market_source" VARCHAR(300),
        ADD COLUMN "market_checked_at" TIMESTAMPTZ
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "catalog"."product"
        DROP COLUMN "market_checked_at",
        DROP COLUMN "market_source"
    `);
  }
}
