import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCartTables1723032000000 implements MigrationInterface {
  name = 'CreateCartTables1723032000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "checkout"."cart" (
      "id" BIGSERIAL PRIMARY KEY, "customer_id" BIGINT, "session_id" VARCHAR(255),
      "status" VARCHAR(15) NOT NULL DEFAULT 'active',
      "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_checkout_active_cart_customer"
      ON "checkout"."cart" ("customer_id") WHERE "status" = 'active' AND "customer_id" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_checkout_active_cart_session"
      ON "checkout"."cart" ("session_id") WHERE "status" = 'active' AND "session_id" IS NOT NULL`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "checkout"."cart_item" (
      "id" BIGSERIAL PRIMARY KEY, "cart_id" BIGINT NOT NULL REFERENCES "checkout"."cart"("id") ON DELETE CASCADE,
      "product_id" BIGINT NOT NULL, "variant_id" BIGINT NOT NULL, "shop_id" BIGINT NOT NULL,
      "quantity" INTEGER NOT NULL CHECK ("quantity" > 0), "unit_price_snapshot" NUMERIC(14,2) NOT NULL CHECK ("unit_price_snapshot" >= 0),
      "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "uq_checkout_cart_item_variant" UNIQUE ("cart_id", "variant_id")
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "checkout"."cart_item"`);
    await queryRunner.query(`DROP TABLE "checkout"."cart"`);
  }
}
