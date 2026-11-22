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
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "finance"."setting" DROP COLUMN "comment"`);
  }
}
