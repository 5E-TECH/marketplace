import { MigrationInterface, QueryRunner } from 'typeorm';
import { processedEventTableSql } from '@app/common';

/**
 * BE-28 (SOT-4, OPR-7): statistika serverda hisoblanadi.
 * - confirmed_at / confirmed_by — tasdiq kuni va tasdiqlagan operator. `order.create-failed` da tozalanadi,
 *   shuning uchun «Tasdiqlangan» soni yaratilgan buyurtmalar bilan mos (lead_attempt bunda eski tasdiqni qoldiradi).
 * - order_status / order_status_at / delivered_at / refused_at — `order.status.changed` dan (BE-18 yuboradi):
 *   yetkazildi va rad kuni, lidning buyurtma holati (sotuvchi lidlari ro‘yxati, «Buyurtma» ustuni).
 * - expected_commission — «Kutilmoqda» haqi: buyurtma narx nusxasidan sotuvchi haqi + ustamaning 85% i (hujjat-statistika-csv H).
 * - processed_event — hodisani bir marta qayta ishlash (BE-03 processOnce).
 * Indekslar: sotuvchi statistikasi (sotuvchi + hodisa vaqti) va operator statistikasi (operator + vaqt).
 */
export class AddLeadStats1795564800000 implements MigrationInterface {
  name = 'AddLeadStats1795564800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lead"."lead"
        ADD COLUMN "confirmed_at" TIMESTAMPTZ,
        ADD COLUMN "confirmed_by" BIGINT,
        ADD COLUMN "order_status" VARCHAR(20),
        ADD COLUMN "order_status_at" TIMESTAMPTZ,
        ADD COLUMN "delivered_at" TIMESTAMPTZ,
        ADD COLUMN "refused_at" TIMESTAMPTZ,
        ADD COLUMN "expected_commission" BIGINT
    `);
    // Hozir tasdiqlangan lidlar: oxirgi CONFIRMED urinishi (lead.operator_id create-failed da bo‘shaydi).
    await queryRunner.query(`
      UPDATE "lead"."lead" l
         SET "confirmed_at" = a."created_at", "confirmed_by" = a."operator_id"
        FROM (
          SELECT DISTINCT ON ("lead_id") "lead_id", "operator_id", "created_at"
            FROM "lead"."lead_attempt"
           WHERE "outcome" = 'CONFIRMED'
           ORDER BY "lead_id", "created_at" DESC, "id" DESC
        ) a
       WHERE a."lead_id" = l."id" AND l."status" = 'CONFIRMED'
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_affiliate_confirmed" ON "lead"."lead" ("affiliate_id", "confirmed_at")
      WHERE "confirmed_at" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_affiliate_delivered" ON "lead"."lead" ("affiliate_id", "delivered_at")
      WHERE "delivered_at" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_affiliate_refused" ON "lead"."lead" ("affiliate_id", "refused_at")
      WHERE "refused_at" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_confirmed_by" ON "lead"."lead" ("confirmed_by", "confirmed_at")
      WHERE "confirmed_by" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_attempt_operator_created" ON "lead"."lead_attempt" ("operator_id", "created_at")
    `);
    await queryRunner.query(processedEventTableSql('lead'));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lead"."processed_event"`);
    for (const idx of [
      'idx_lead_lead_attempt_operator_created',
      'idx_lead_lead_confirmed_by',
      'idx_lead_lead_affiliate_refused',
      'idx_lead_lead_affiliate_delivered',
      'idx_lead_lead_affiliate_confirmed',
    ])
      await queryRunner.query(`DROP INDEX IF EXISTS "lead"."${idx}"`);
    await queryRunner.query(`
      ALTER TABLE "lead"."lead"
        DROP COLUMN IF EXISTS "expected_commission",
        DROP COLUMN IF EXISTS "refused_at",
        DROP COLUMN IF EXISTS "delivered_at",
        DROP COLUMN IF EXISTS "order_status_at",
        DROP COLUMN IF EXISTS "order_status",
        DROP COLUMN IF EXISTS "confirmed_by",
        DROP COLUMN IF EXISTS "confirmed_at"
    `);
  }
}
