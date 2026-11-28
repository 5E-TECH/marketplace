import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-45 TC6 (ega qarori 2026-11-28, EQ-14): operatorga upsell bonusi. Har qo‘shilgan boshqa tovarga (lid qatori) bitta
 * bonus, mijoz tovarni olganda; summa — superadmin sozlamasidan, hisoblangan paytdagisi bilan qoladi. Buyurtma
 * qaytarilsa — bekor (`cancelled_at`). Ish haqi bilan to‘lanadi (TZ 2.5) — tizim faqat hisoblaydi.
 */
export class OperatorBonus1799452800000 implements MigrationInterface {
  name = 'OperatorBonus1799452800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "lead"."operator_bonus_setting" (
        "id" SMALLINT PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
        "upsell_bonus" BIGINT NOT NULL DEFAULT 0 CHECK ("upsell_bonus" >= 0),
        "updated_by" BIGINT,
        "updated_at" TIMESTAMPTZ
      )
    `);
    await q.query(
      `INSERT INTO "lead"."operator_bonus_setting" ("id") VALUES (1)`,
    );
    await q.query(`
      CREATE TABLE "lead"."operator_bonus" (
        "id" BIGSERIAL PRIMARY KEY,
        "kind" VARCHAR(16) NOT NULL DEFAULT 'UPSELL',
        "lead_id" BIGINT NOT NULL REFERENCES "lead"."lead" ("id"),
        "lead_item_id" BIGINT NOT NULL,
        "operator_id" BIGINT NOT NULL,
        "product_id" BIGINT NOT NULL,
        "order_id" BIGINT,
        "amount" BIGINT NOT NULL CHECK ("amount" > 0),
        "earned_at" TIMESTAMPTZ NOT NULL,
        "cancelled_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_lead_operator_bonus_item" UNIQUE ("kind", "lead_item_id")
      )
    `);
    await q.query(`
      CREATE INDEX "idx_lead_operator_bonus_operator" ON "lead"."operator_bonus" ("operator_id", "earned_at")
    `);
    await q.query(`
      CREATE INDEX "idx_lead_operator_bonus_lead" ON "lead"."operator_bonus" ("lead_id")
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "lead"."operator_bonus"`);
    await q.query(`DROP TABLE "lead"."operator_bonus_setting"`);
  }
}
