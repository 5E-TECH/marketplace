import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-26 (T8: «admin va moliya uchun 2FA»): xodimda TOTP — sir shifrlangan (AES-256-GCM), oxirgi ishlatilgan
 * oraliq (qayta ishlatishdan himoya), tiklash kodlari (xeshi), xato urinishlar va blok.
 */
export class StaffTwoFactor1797724800000 implements MigrationInterface {
  name = 'StaffTwoFactor1797724800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "identity"."users"
      ADD COLUMN "totp_secret_enc" TEXT,
      ADD COLUMN "totp_enabled_at" TIMESTAMPTZ,
      ADD COLUMN "totp_last_step" BIGINT,
      ADD COLUMN "totp_recovery" JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN "totp_failed_count" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN "totp_blocked_until" TIMESTAMPTZ`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "identity"."users"
      DROP COLUMN "totp_blocked_until",
      DROP COLUMN "totp_failed_count",
      DROP COLUMN "totp_recovery",
      DROP COLUMN "totp_last_step",
      DROP COLUMN "totp_enabled_at",
      DROP COLUMN "totp_secret_enc"`);
  }
}
