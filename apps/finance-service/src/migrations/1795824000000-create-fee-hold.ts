import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-35 (TZ 7: «haq tekshiruvgacha ushlab turiladi», «bloklash va ushlab turilgan haqni bekor qilish»):
 * lid bo‘yicha sotuvchi haqining holati. HELD va CANCELLED da sotuvchi (AFFILIATE) yozuvlari Elchi o‘tkazmasidan
 * keyin ham HOLD da qoladi; RELEASED da odatdagidek AVAILABLE ga o‘tadi. CANCELLED — yakuniy.
 */
export class CreateFeeHold1795824000000 implements MigrationInterface {
  name = 'CreateFeeHold1795824000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "finance"."fee_hold" (
        "lead_id" VARCHAR(64) PRIMARY KEY,
        "affiliate_id" VARCHAR(64) NOT NULL,
        "status" VARCHAR(10) NOT NULL,
        "incident_id" VARCHAR(64),
        "reason" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_finance_fee_hold_status" CHECK ("status" IN ('HELD','RELEASED','CANCELLED'))
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "finance"."fee_hold"`);
  }
}
