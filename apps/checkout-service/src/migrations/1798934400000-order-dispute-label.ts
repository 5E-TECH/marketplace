import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-25 (FE-26): «Nizoli» belgisi (TEL-6: nizoli buyurtmaning qo‘ng‘iroq yozuvi 1 yil saqlanadi) va yorliqni qayta chop
 * etish jurnali (kim, qachon, sabab). Bitta buyurtmada bir vaqtda bitta ochiq nizo; yopilgani tarixda qoladi.
 * Ro‘yxat indekslari: posilka va tovar qatorlari buyurtma bo‘yicha (indekssiz har buyurtmaga to‘liq jadval o‘qilardi),
 * yaratilgan vaqt va tasdiqlagan operator bo‘yicha.
 */
export class OrderDisputeLabel1798934400000 implements MigrationInterface {
  name = 'OrderDisputeLabel1798934400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "checkout"."order_dispute" (
        "id" BIGSERIAL PRIMARY KEY,
        "order_id" BIGINT NOT NULL REFERENCES "checkout"."sales_order"("id"),
        "reason" TEXT NOT NULL,
        "opened_by" BIGINT NOT NULL,
        "opened_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "keep_until" TIMESTAMPTZ NOT NULL,
        "closed_by" BIGINT,
        "closed_at" TIMESTAMPTZ,
        "close_comment" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_checkout_order_dispute_closed"
          CHECK (("closed_at" IS NULL) = ("closed_by" IS NULL))
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX "uq_checkout_order_dispute_open"
      ON "checkout"."order_dispute" ("order_id") WHERE "closed_at" IS NULL
    `);
    await q.query(`
      CREATE INDEX "idx_checkout_order_dispute_order"
      ON "checkout"."order_dispute" ("order_id", "id")
    `);
    await q.query(`
      CREATE TABLE "checkout"."label_reprint" (
        "id" BIGSERIAL PRIMARY KEY,
        "order_id" BIGINT NOT NULL REFERENCES "checkout"."sales_order"("id"),
        "actor_id" BIGINT NOT NULL,
        "reason" TEXT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      CREATE INDEX "idx_checkout_label_reprint_order"
      ON "checkout"."label_reprint" ("order_id", "id")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_checkout_parcel_order"
      ON "checkout"."parcel" ("sales_order_id")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_checkout_sales_order_item_parcel"
      ON "checkout"."sales_order_item" ("sales_order_seller_id")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_checkout_sales_order_created"
      ON "checkout"."sales_order" ("created_at" DESC, "id" DESC)
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "idx_checkout_sales_order_confirmed_by"
      ON "checkout"."sales_order" ("confirmed_by", "created_at" DESC)
      WHERE "confirmed_by" IS NOT NULL
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const name of [
      'idx_checkout_sales_order_confirmed_by',
      'idx_checkout_sales_order_created',
      'idx_checkout_sales_order_item_parcel',
      'idx_checkout_parcel_order',
    ])
      await q.query(`DROP INDEX IF EXISTS "checkout"."${name}"`);
    await q.query(`DROP TABLE "checkout"."label_reprint"`);
    await q.query(`DROP TABLE "checkout"."order_dispute"`);
  }
}
