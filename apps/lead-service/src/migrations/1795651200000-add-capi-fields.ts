import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-31 (Meta Conversions API): capi_delivery ga
 * - event_time — hodisa vaqti (Lead — lid kelgan, Purchase — yetkazilgan); Meta 7 kundan eski hodisani rad etadi;
 * - value — Purchase summasi, so‘m (UZS);
 * - last_error — Meta xatosi yoki sabab: sotuvchi jurnalda ko‘radi (TC3).
 */
export class AddCapiFields1795651200000 implements MigrationInterface {
  name = 'AddCapiFields1795651200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lead"."capi_delivery"
        ADD COLUMN "event_time" TIMESTAMPTZ,
        ADD COLUMN "value" BIGINT,
        ADD COLUMN "last_error" VARCHAR(500)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lead"."capi_delivery"
        DROP COLUMN IF EXISTS "last_error",
        DROP COLUMN IF EXISTS "value",
        DROP COLUMN IF EXISTS "event_time"
    `);
  }
}
