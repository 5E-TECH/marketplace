import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-33 (QA 2026-11-21): matnli sozlamalar — to‘lovchi (platforma) rekvizitlari bank fayli uchun (EQ-05). Raqamli
 * `finance.setting` (BIGINT) MFO kabi 0 bilan boshlanadigan qiymatni saqlay olmaydi. Tarix saqlanadi.
 */
export class CreateTextSetting1796774400000 implements MigrationInterface {
  name = 'CreateTextSetting1796774400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "finance"."text_setting" (
        "key" VARCHAR(40) NOT NULL,
        "value" TEXT NOT NULL,
        "effective_from" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "changed_by" VARCHAR(64),
        CONSTRAINT "pk_finance_text_setting" PRIMARY KEY ("key", "effective_from")
      )
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS "finance"."text_setting"');
  }
}
