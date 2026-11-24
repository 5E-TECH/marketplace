import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-25 (FE-12, FE-16; TZ OMB-3, 8-bo‘lim): toifa belgilari — BAD va «muddat kuzatiladi». NULL — ota toifadan meros,
 * eng yuqorida «yo‘q».
 */
export class CategoryFlags1798502400000 implements MigrationInterface {
  name = 'CategoryFlags1798502400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "catalog"."category"
        ADD COLUMN "is_bad" BOOLEAN,
        ADD COLUMN "expiry_tracked" BOOLEAN
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "catalog"."category"
        DROP COLUMN "expiry_tracked",
        DROP COLUMN "is_bad"
    `);
  }
}
