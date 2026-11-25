import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-25 (FE-26): «Nizoli» belgisi (TEL-6: nizoli buyurtmaning qo‘ng‘iroq yozuvi 1 yil saqlanadi) va yorliqni qayta chop
 * etish jurnali (kim, qachon, sabab). Bitta buyurtmada bir vaqtda bitta ochiq nizo; yopilgani tarixda qoladi.
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
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "checkout"."label_reprint"`);
    await q.query(`DROP TABLE "checkout"."order_dispute"`);
  }
}
