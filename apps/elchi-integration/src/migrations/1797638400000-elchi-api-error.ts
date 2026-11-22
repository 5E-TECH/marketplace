import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-26 (T8 «Kuzatuv»: Elchi API xatolari): har Elchi so‘rovi xatosi (posilka yaratish va bekor qilish) jurnalga —
 * monitor oxirgi 5 daqiqadagi sonini oladi (karta TC3: 5 daqiqada 10 dan ko‘p → ogohlantirish). 7 kundan eskisi o‘chadi.
 */
export class ElchiApiError1797638400000 implements MigrationInterface {
  name = 'ElchiApiError1797638400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "integration"."elchi_api_error" (
        "id" BIGSERIAL PRIMARY KEY,
        "at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "operation" VARCHAR(30) NOT NULL,
        "status" INTEGER,
        "message" VARCHAR(500)
      )`);
    await q.query(
      `CREATE INDEX "idx_integration_elchi_api_error_at" ON "integration"."elchi_api_error" ("at")`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "integration"."elchi_api_error"`);
  }
}
