import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-27 (ADM-2, ADM-6): sozlama qatorida izoh — kim so‘radi va sabab. Audit (identity) yozilmay qolsa ham izoh
 * moliya bazasida qoladi.
 */
export class SettingComment1797552000000 implements MigrationInterface {
  name = 'SettingComment1797552000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "finance"."setting" ADD COLUMN "comment" VARCHAR(500)`,
    );
    // bekor qilingan (kuchga kirmagan) qiymatlar izi — kim, qachon, nega
    await q.query(`
      CREATE TABLE "finance"."setting_cancelled" (
        "id" BIGSERIAL PRIMARY KEY,
        "key" VARCHAR(40) NOT NULL,
        "value" BIGINT NOT NULL,
        "effective_from" TIMESTAMPTZ NOT NULL,
        "changed_by" VARCHAR(64),
        "comment" VARCHAR(500),
        "cancelled_by" VARCHAR(64) NOT NULL,
        "cancel_comment" VARCHAR(500) NOT NULL,
        "cancelled_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "finance"."setting_cancelled"`);
    await q.query(`ALTER TABLE "finance"."setting" DROP COLUMN "comment"`);
  }
}
