import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-01 (TZ T9-1, T8 «Pul»): pul ustunlari NUMERIC(14,2) → BIGINT, butun so‘m.
 * Baza toza boshlanadi (1-bo‘lim, 3-qaror); mavjud qatorlar `round()` bilan butun so‘mga o‘tadi.
 */
export class MoneyToBigint1795219200000 implements MigrationInterface {
  name = 'MoneyToBigint1795219200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "checkout"."sales_order"
        ALTER COLUMN "total_amount" TYPE BIGINT USING round("total_amount")::bigint,
        ALTER COLUMN "delivery_fee" TYPE BIGINT USING round("delivery_fee")::bigint
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."sales_order_seller"
        ALTER COLUMN "subtotal" TYPE BIGINT USING round("subtotal")::bigint,
        ALTER COLUMN "cod_amount" TYPE BIGINT USING round("cod_amount")::bigint,
        ALTER COLUMN "delivery_fee" TYPE BIGINT USING round("delivery_fee")::bigint,
        ALTER COLUMN "elchi_to_be_paid" TYPE BIGINT USING round("elchi_to_be_paid")::bigint
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."sales_order_item"
        ALTER COLUMN "unit_price" TYPE BIGINT USING round("unit_price")::bigint,
        ALTER COLUMN "line_total" TYPE BIGINT USING round("line_total")::bigint
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."return_request"
        ALTER COLUMN "requested_amount" TYPE BIGINT USING round("requested_amount")::bigint,
        ALTER COLUMN "refunded_amount" TYPE BIGINT USING round("refunded_amount")::bigint
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."return_request_item"
        ALTER COLUMN "unit_price" TYPE BIGINT USING round("unit_price")::bigint,
        ALTER COLUMN "line_total" TYPE BIGINT USING round("line_total")::bigint
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."cart_item"
        ALTER COLUMN "unit_price_snapshot" TYPE BIGINT USING round("unit_price_snapshot")::bigint
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "checkout"."sales_order"
        ALTER COLUMN "total_amount" TYPE NUMERIC(14,2) USING "total_amount"::numeric,
        ALTER COLUMN "delivery_fee" TYPE NUMERIC(14,2) USING "delivery_fee"::numeric
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."sales_order_seller"
        ALTER COLUMN "subtotal" TYPE NUMERIC(14,2) USING "subtotal"::numeric,
        ALTER COLUMN "cod_amount" TYPE NUMERIC(14,2) USING "cod_amount"::numeric,
        ALTER COLUMN "delivery_fee" TYPE NUMERIC(14,2) USING "delivery_fee"::numeric,
        ALTER COLUMN "elchi_to_be_paid" TYPE NUMERIC(14,2) USING "elchi_to_be_paid"::numeric
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."sales_order_item"
        ALTER COLUMN "unit_price" TYPE NUMERIC(14,2) USING "unit_price"::numeric,
        ALTER COLUMN "line_total" TYPE NUMERIC(14,2) USING "line_total"::numeric
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."return_request"
        ALTER COLUMN "requested_amount" TYPE NUMERIC(14,2) USING "requested_amount"::numeric,
        ALTER COLUMN "refunded_amount" TYPE NUMERIC(14,2) USING "refunded_amount"::numeric
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."return_request_item"
        ALTER COLUMN "unit_price" TYPE NUMERIC(14,2) USING "unit_price"::numeric,
        ALTER COLUMN "line_total" TYPE NUMERIC(14,2) USING "line_total"::numeric
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."cart_item"
        ALTER COLUMN "unit_price_snapshot" TYPE NUMERIC(14,2) USING "unit_price_snapshot"::numeric
    `);
  }
}
