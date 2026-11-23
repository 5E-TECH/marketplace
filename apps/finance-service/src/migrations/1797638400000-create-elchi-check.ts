import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-46 TC3 (ega qarori 2026-11-24, «Avtomatik so‘rov»): Elchi bilan kunlik avtomatik tekshiruv.
 * - `elchi_check_run` — bitta tekshiruv: kun (Toshkent), kim/nima ishga tushirgani, sonlar, butunlay yiqilgan bo‘lsa
 *   xato, xabar yuborilgan vaqt.
 * - `elchi_check_item` — faqat farqli (DIFF) va o‘qib bo‘lmagan (FAILED) posilkalar; mos posilkalar faqat sanaladi.
 *   `signature` — farqning o‘zi (sabablar, holatlar, summalar): keyingi tekshiruvda xuddi shu farq bo‘lsa, oldingi izoh
 *   ko‘chiriladi (`resolution_carried`) — o‘zgarmagan farqni moliya har kuni qayta yopmaydi.
 * Pul harakati yo‘q — tekshiruv faqat ko‘rsatadi.
 */
export class CreateElchiCheck1797638400000 implements MigrationInterface {
  name = 'CreateElchiCheck1797638400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "finance"."elchi_check_run" (
        "id" BIGSERIAL PRIMARY KEY,
        "check_date" DATE NOT NULL,
        "trigger" VARCHAR(10) NOT NULL,
        "triggered_by" VARCHAR(64),
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "finished_at" TIMESTAMPTZ,
        "checked" INTEGER NOT NULL DEFAULT 0,
        "matched" INTEGER NOT NULL DEFAULT 0,
        "diff_count" INTEGER NOT NULL DEFAULT 0,
        "resolved_count" INTEGER NOT NULL DEFAULT 0,
        "failed" INTEGER NOT NULL DEFAULT 0,
        "truncated" BOOLEAN NOT NULL DEFAULT false,
        "error" VARCHAR(1000),
        "alerted_at" TIMESTAMPTZ,
        CONSTRAINT "chk_finance_elchi_check_trigger" CHECK ("trigger" IN ('CRON', 'MANUAL'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_finance_elchi_check_run_date" ON "finance"."elchi_check_run" ("check_date", "id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "finance"."elchi_check_item" (
        "id" BIGSERIAL PRIMARY KEY,
        "run_id" BIGINT NOT NULL REFERENCES "finance"."elchi_check_run"("id"),
        "order_id" VARCHAR(64) NOT NULL,
        "order_number" VARCHAR(64) NOT NULL,
        "shipment_id" VARCHAR(64) NOT NULL,
        "state" VARCHAR(10) NOT NULL,
        "reasons" TEXT[] NOT NULL DEFAULT '{}',
        "order_status" VARCHAR(20) NOT NULL,
        "elchi_status" VARCHAR(40),
        "cod_amount" BIGINT NOT NULL,
        "elchi_collected" BIGINT,
        "elchi_fee" BIGINT,
        "elchi_market_paid" BIGINT,
        "recorded_collected" BIGINT,
        "recorded_fee" BIGINT,
        "recorded_market_paid" BIGINT,
        "error" VARCHAR(500),
        "signature" VARCHAR(1000) NOT NULL,
        "resolution_comment" VARCHAR(1000),
        "resolved_by" VARCHAR(64),
        "resolved_at" TIMESTAMPTZ,
        "resolution_carried" BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_finance_elchi_check_item_state" CHECK ("state" IN ('DIFF', 'FAILED')),
        CONSTRAINT "chk_finance_elchi_check_item_resolution" CHECK (
          ("resolved_at" IS NULL) = ("resolved_by" IS NULL)
          AND ("resolved_at" IS NULL) = ("resolution_comment" IS NULL)
          AND ("resolved_at" IS NULL OR "state" = 'DIFF')),
        CONSTRAINT "uq_finance_elchi_check_item_order" UNIQUE ("run_id", "order_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_finance_elchi_check_item_order" ON "finance"."elchi_check_item" ("order_id", "id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "finance"."elchi_check_item"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "finance"."elchi_check_run"`);
  }
}
