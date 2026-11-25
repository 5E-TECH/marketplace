import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-25 5-tur (ega, 2026-11-25): sotuvchining JShShIR arizasi.
 * - Har yuborish — alohida qator; amaldagisi sotuvchining oxirgi qatori. Bir sotuvchida bittadan ortiq PENDING yoki
 *   VERIFIED bo‘lmaydi. SUPERSEDED — ism-familiya o‘zgarib, o‘rniga yangi tekshiruv ochilgan.
 * - JShShIR shifrlangan (`pinfl_cipher`), ochiq faqat oxirgi 4 raqam; `pinfl_hash` — kalitli xesh (bir JShShIR ikki
 *   sotuvchida ekanini ko‘rish uchun). MANUAL qatorda JShShIR yo‘q (moliya arizasiz belgilagan, BE-23).
 * - Pul yechish darvozasi o‘zgarmaydi: `affiliate_payout_profile.self_employed` (shu tranzaksiyada qo‘yiladi).
 * Eski qo‘lda qo‘yilgan belgilar MANUAL tasdiqlangan qator bo‘lib ko‘chadi (ism noma’lum — bo‘sh).
 */
export class CreateSelfEmployed1798761600000 implements MigrationInterface {
  name = 'CreateSelfEmployed1798761600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "finance"."self_employed_application" (
        "id" BIGSERIAL PRIMARY KEY,
        "affiliate_id" VARCHAR(64) NOT NULL,
        "status" VARCHAR(12) NOT NULL,
        "source" VARCHAR(12) NOT NULL,
        "full_name" VARCHAR(255) NOT NULL,
        "pinfl_cipher" VARCHAR(200),
        "pinfl_last4" CHAR(4),
        "pinfl_hash" CHAR(64),
        "document_key" VARCHAR(300),
        "document_name" VARCHAR(255),
        "document_type" VARCHAR(40),
        "document_size" INTEGER,
        "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "verified_at" TIMESTAMPTZ,
        "verified_by" VARCHAR(64),
        "decided_at" TIMESTAMPTZ,
        "decided_by" VARCHAR(64),
        "reason" VARCHAR(30),
        "comment" VARCHAR(500),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_finance_self_employed_status" CHECK (
          "status" IN ('PENDING', 'VERIFIED', 'REJECTED', 'REVOKED', 'SUPERSEDED')),
        CONSTRAINT "chk_finance_self_employed_source" CHECK (
          "source" IN ('SELLER', 'NAME_CHANGE', 'MANUAL')),
        CONSTRAINT "chk_finance_self_employed_pinfl" CHECK (
          ("pinfl_cipher" IS NULL) = ("pinfl_last4" IS NULL)
          AND ("pinfl_cipher" IS NULL) = ("pinfl_hash" IS NULL)
          AND ("pinfl_cipher" IS NOT NULL OR "source" = 'MANUAL')),
        CONSTRAINT "chk_finance_self_employed_document" CHECK (
          ("document_key" IS NULL) = ("document_name" IS NULL)
          AND ("document_key" IS NULL) = ("document_type" IS NULL)
          AND ("document_key" IS NULL) = ("document_size" IS NULL)),
        CONSTRAINT "chk_finance_self_employed_decided" CHECK (
          "status" NOT IN ('VERIFIED', 'REJECTED', 'REVOKED')
          OR ("decided_at" IS NOT NULL AND "decided_by" IS NOT NULL)),
        CONSTRAINT "chk_finance_self_employed_rejected" CHECK (
          "status" <> 'REJECTED' OR "reason" IS NOT NULL)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_finance_self_employed_open"
        ON "finance"."self_employed_application" ("affiliate_id")
        WHERE "status" IN ('PENDING', 'VERIFIED')
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_finance_self_employed_affiliate"
        ON "finance"."self_employed_application" ("affiliate_id", "id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_finance_self_employed_hash"
        ON "finance"."self_employed_application" ("pinfl_hash")
        WHERE "pinfl_hash" IS NOT NULL
    `);
    await queryRunner.query(`
      INSERT INTO "finance"."self_employed_application"
        ("affiliate_id", "status", "source", "full_name", "submitted_at", "verified_at", "verified_by", "decided_at", "decided_by")
      SELECT "affiliate_id", 'VERIFIED', 'MANUAL', '', "updated_at", "updated_at", "updated_by", "updated_at", "updated_by"
        FROM "finance"."affiliate_payout_profile"
       WHERE "self_employed"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "finance"."self_employed_application"`,
    );
  }
}
