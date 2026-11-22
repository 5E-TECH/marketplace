import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-24 (BUY-6): mijozga SMS — mijoz tizim foydalanuvchisi emas (BE-05), shuning uchun `user_id` ixtiyoriy.
 * `dedupe_key` — bir hodisaga bir xabar (masalan `order:<id>:CONFIRMED`; hodisa qayta kelsa ikkinchi SMS yo‘q).
 */
export class CustomerSms1797811200000 implements MigrationInterface {
  name = 'CustomerSms1797811200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "notification"."notification"
      ALTER COLUMN "user_id" DROP NOT NULL,
      ADD COLUMN "dedupe_key" VARCHAR(120)`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_notification_dedupe_key" ON "notification"."notification" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "notification"."uq_notification_dedupe_key"`);
    await q.query(
      `DELETE FROM "notification"."notification" WHERE "user_id" IS NULL`,
    );
    await q.query(`ALTER TABLE "notification"."notification"
      DROP COLUMN "dedupe_key",
      ALTER COLUMN "user_id" SET NOT NULL`);
  }
}
