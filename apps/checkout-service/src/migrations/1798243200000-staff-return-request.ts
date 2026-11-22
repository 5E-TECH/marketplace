import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-44: yetkazilgandan keyin qaytarish so‘rovini xodim (admin yoki operator) mijoz nomidan kiritadi — mijoz tizim
 * foydalanuvchisi emas (`customer_id` bo‘sh), kim kiritgani `created_by` da, manba `source` (BUYER — eski xaridor
 * so‘rovlari, STAFF — xodim).
 */
export class StaffReturnRequest1798243200000 implements MigrationInterface {
  name = 'StaffReturnRequest1798243200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "checkout"."return_request"
        ALTER COLUMN "customer_id" DROP NOT NULL,
        ADD COLUMN "created_by" BIGINT,
        ADD COLUMN "source" VARCHAR(10) NOT NULL DEFAULT 'BUYER',
        ADD CONSTRAINT "chk_checkout_return_request_source" CHECK (
          ("source" = 'BUYER' AND "customer_id" IS NOT NULL) OR
          ("source" = 'STAFF' AND "created_by" IS NOT NULL)
        )
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "checkout"."return_request_history" WHERE return_request_id IN
         (SELECT id FROM "checkout"."return_request" WHERE "source" = 'STAFF')`,
    );
    await q.query(
      `DELETE FROM "checkout"."return_request_item" WHERE return_request_id IN
         (SELECT id FROM "checkout"."return_request" WHERE "source" = 'STAFF')`,
    );
    await q.query(
      `DELETE FROM "checkout"."return_request" WHERE "source" = 'STAFF'`,
    );
    await q.query(`
      ALTER TABLE "checkout"."return_request"
        DROP CONSTRAINT IF EXISTS "chk_checkout_return_request_source",
        DROP COLUMN IF EXISTS "source",
        DROP COLUMN IF EXISTS "created_by",
        ALTER COLUMN "customer_id" SET NOT NULL
    `);
  }
}
