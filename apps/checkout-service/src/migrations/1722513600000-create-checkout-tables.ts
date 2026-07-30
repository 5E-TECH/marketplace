import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCheckoutTables1722513600000 implements MigrationInterface {
  name = 'CreateCheckoutTables1722513600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checkout"."sales_order" (
        "id" BIGSERIAL PRIMARY KEY,
        "customer_id" BIGINT NOT NULL,
        "buyer_name" VARCHAR(255),
        "status" VARCHAR(25) NOT NULL DEFAULT 'DRAFT',
        "payment_method" VARCHAR(10) NOT NULL,
        "total_amount" NUMERIC(14,2) NOT NULL,
        "delivery_address" TEXT,
        "region_id" BIGINT,
        "district_id" BIGINT,
        "where_deliver" VARCHAR(10) NOT NULL DEFAULT 'ADDRESS',
        "reservation_id" BIGINT,
        "payment_id" BIGINT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checkout"."sales_order_seller" (
        "id" BIGSERIAL PRIMARY KEY,
        "sales_order_id" BIGINT NOT NULL REFERENCES "checkout"."sales_order"("id"),
        "shop_id" BIGINT NOT NULL,
        "elchi_market_id" BIGINT,
        "subtotal" NUMERIC(14,2) NOT NULL,
        "cod_amount" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "elchi_shipment_id" BIGINT,
        "tracking_url" VARCHAR(1000),
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."sales_order"
      ADD COLUMN IF NOT EXISTS "buyer_name" VARCHAR(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."sales_order_seller"
      ADD COLUMN IF NOT EXISTS "tracking_url" VARCHAR(1000)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_checkout_seller_shop_created"
      ON "checkout"."sales_order_seller" ("shop_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "checkout"."sales_order_item" (
        "id" BIGSERIAL PRIMARY KEY,
        "sales_order_seller_id" BIGINT NOT NULL
          REFERENCES "checkout"."sales_order_seller"("id"),
        "product_id" BIGINT NOT NULL,
        "product_name" VARCHAR(255) NOT NULL,
        "variant_id" BIGINT NOT NULL,
        "quantity" INTEGER NOT NULL,
        "unit_price" NUMERIC(14,2) NOT NULL,
        "line_total" NUMERIC(14,2) NOT NULL
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout"."sales_order_item"
      ADD COLUMN IF NOT EXISTS "product_name" VARCHAR(255) NOT NULL DEFAULT ''
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "checkout"."sales_order_item"`);
    await queryRunner.query(`DROP TABLE "checkout"."sales_order_seller"`);
    await queryRunner.query(`DROP TABLE "checkout"."sales_order"`);
  }
}
