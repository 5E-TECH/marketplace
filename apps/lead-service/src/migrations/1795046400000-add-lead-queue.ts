import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-13: operator navbati uchun ustunlar.
 * - booked_from_callback — bron rejalashtirilgan qo‘ng‘iroqdanmi (6-qoida: ular 5 ta chegaraga kirmaydi);
 * - callback_reminded_at — 8-qoida eslatmasi yuborilgan vaqt (takrorlanmasin);
 * - stock_shortage_at — `order.create-failed` (qoldiq yo‘q) bilan qaytgan vaqt (TC8).
 */
export class AddLeadQueue1795046400000 implements MigrationInterface {
  name = 'AddLeadQueue1795046400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lead"."lead"
        ADD COLUMN "booked_from_callback" BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN "callback_reminded_at" TIMESTAMPTZ,
        ADD COLUMN "stock_shortage_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_operator_status"
      ON "lead"."lead" ("operator_id", "status")
      WHERE "operator_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "lead"."idx_lead_lead_operator_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "lead"."lead"
        DROP COLUMN IF EXISTS "stock_shortage_at",
        DROP COLUMN IF EXISTS "callback_reminded_at",
        DROP COLUMN IF EXISTS "booked_from_callback"
    `);
  }
}
