import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-32 (TZ MOL-6, T02:85): sotuvchi kartasiga pul o‘tkazish.
 * - `payout_card` — sotuvchining kartasi: provayder tokeni shifrlangan (`token_cipher`), niqob faqat birinchi 4 va oxirgi
 *   4 raqam. To‘liq karta raqami uchun ustun yo‘q. Sotuvchida bitta faol karta.
 * - `payout_card_session` — provayder sahifasida kartani ulash sessiyasi (bir martalik).
 * - `withdrawal_request`: `PAYING` (yuborildi, javob kutilmoqda) va `FAILED` (provayder rad etdi — ledgerga yozilmagan,
 *   pul «Mavjud» da). So‘rovga yuborilgan karta (token va niqob) yoziladi — keyin karta o‘zgarsa ham qaysi kartaga ketgani
 *   ma’lum. `FAILED` kunlik cheklovni band qilmaydi — sotuvchi o‘sha kuni yangi so‘rov yuboradi [taklif].
 */
export class CreatePayoutCard1799107200000 implements MigrationInterface {
  name = 'CreatePayoutCard1799107200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "finance"."payout_card" (
        "id" BIGSERIAL PRIMARY KEY,
        "affiliate_id" VARCHAR(64) NOT NULL,
        "status" VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',
        "token_cipher" VARCHAR(700) NOT NULL,
        "mask" VARCHAR(19) NOT NULL,
        "system" VARCHAR(8),
        "holder_name" VARCHAR(120),
        "session_ref" UUID NOT NULL,
        "bound_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "removed_at" TIMESTAMPTZ,
        CONSTRAINT "chk_finance_payout_card_status" CHECK ("status" IN ('ACTIVE', 'REMOVED')),
        CONSTRAINT "chk_finance_payout_card_mask" CHECK ("mask" ~ '^[0-9]{4} [*]{4} [*]{4} [0-9]{4}$'),
        CONSTRAINT "chk_finance_payout_card_system" CHECK ("system" IS NULL OR "system" IN ('UZCARD', 'HUMO')),
        CONSTRAINT "chk_finance_payout_card_removed" CHECK (("status" = 'REMOVED') = ("removed_at" IS NOT NULL)),
        CONSTRAINT "uq_finance_payout_card_session" UNIQUE ("session_ref")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_finance_payout_card_active" ON "finance"."payout_card" ("affiliate_id") WHERE "status" = 'ACTIVE'`,
    );
    await queryRunner.query(`
      CREATE TABLE "finance"."payout_card_session" (
        "ref" UUID PRIMARY KEY,
        "affiliate_id" VARCHAR(64) NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "used_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_finance_payout_card_session_affiliate" ON "finance"."payout_card_session" ("affiliate_id", "created_at" DESC)`,
    );

    await queryRunner.query(`
      ALTER TABLE "finance"."withdrawal_request"
        ADD COLUMN "payout_mode" VARCHAR(6),
        ADD COLUMN "payout_card_id" BIGINT REFERENCES "finance"."payout_card"("id"),
        ADD COLUMN "card_token_cipher" VARCHAR(700),
        ADD COLUMN "card_mask" VARCHAR(19),
        ADD COLUMN "payout_ref" VARCHAR(24),
        ADD COLUMN "payout_sent_at" TIMESTAMPTZ,
        ADD COLUMN "payout_checked_at" TIMESTAMPTZ,
        ADD COLUMN "fail_reason" VARCHAR(500),
        ADD COLUMN "failed_at" TIMESTAMPTZ,
        ADD COLUMN "payout_resolved_by" VARCHAR(64),
        ADD COLUMN "payout_note" VARCHAR(500),
        ADD COLUMN "overdue_notified_at" TIMESTAMPTZ
    `);
    // eski «To‘landi» lar qo‘lda bo‘lgan (BE-23)
    await queryRunner.query(
      `UPDATE "finance"."withdrawal_request" SET "payout_mode" = 'MANUAL' WHERE "status" = 'PAID'`,
    );
    await queryRunner.query(`
      ALTER TABLE "finance"."withdrawal_request"
        DROP CONSTRAINT "chk_finance_withdrawal_status",
        ADD CONSTRAINT "chk_finance_withdrawal_status"
          CHECK ("status" IN ('REQUESTED','APPROVED','PAYING','PAID','REJECTED','FAILED')),
        ADD CONSTRAINT "chk_finance_withdrawal_payout_mode"
          CHECK ("payout_mode" IS NULL OR "payout_mode" IN ('MANUAL', 'CARD')),
        ADD CONSTRAINT "chk_finance_withdrawal_card_mask"
          CHECK ("card_mask" IS NULL OR "card_mask" ~ '^[0-9]{4} [*]{4} [*]{4} [0-9]{4}$'),
        ADD CONSTRAINT "chk_finance_withdrawal_paying"
          CHECK ("status" NOT IN ('PAYING', 'FAILED') OR
                 ("payout_mode" = 'CARD' AND "payout_ref" IS NOT NULL AND "payout_sent_at" IS NOT NULL
                  AND "card_token_cipher" IS NOT NULL AND "card_mask" IS NOT NULL)),
        ADD CONSTRAINT "chk_finance_withdrawal_failed"
          CHECK ("status" <> 'FAILED' OR ("fail_reason" IS NOT NULL AND "failed_at" IS NOT NULL))
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_finance_withdrawal_payout_ref" ON "finance"."withdrawal_request" ("payout_ref") WHERE "payout_ref" IS NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX "finance"."uq_finance_withdrawal_daily"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_finance_withdrawal_daily" ON "finance"."withdrawal_request" ("affiliate_id", "request_day")
      WHERE "status" NOT IN ('REJECTED', 'FAILED')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // qaytarishda yangi holatlar eski cheklovga sig‘maydi: kartaga yuborilganlar qo‘lda hal qilinishi kerak
    const [{ n }] = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM "finance"."withdrawal_request" WHERE "status" IN ('PAYING', 'FAILED')`,
    )) as Array<{ n: number }>;
    if (n > 0)
      throw new Error(
        `withdrawal_request: ${n} ta PAYING/FAILED so‘rov bor — qaytarishdan oldin qo‘lda hal qiling`,
      );
    await queryRunner.query(
      `DROP INDEX "finance"."uq_finance_withdrawal_daily"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_finance_withdrawal_daily" ON "finance"."withdrawal_request" ("affiliate_id", "request_day")
      WHERE "status" <> 'REJECTED'
    `);
    await queryRunner.query(
      `DROP INDEX "finance"."uq_finance_withdrawal_payout_ref"`,
    );
    await queryRunner.query(`
      ALTER TABLE "finance"."withdrawal_request"
        DROP CONSTRAINT "chk_finance_withdrawal_failed",
        DROP CONSTRAINT "chk_finance_withdrawal_paying",
        DROP CONSTRAINT "chk_finance_withdrawal_card_mask",
        DROP CONSTRAINT "chk_finance_withdrawal_payout_mode",
        DROP CONSTRAINT "chk_finance_withdrawal_status",
        ADD CONSTRAINT "chk_finance_withdrawal_status"
          CHECK ("status" IN ('REQUESTED','APPROVED','PAID','REJECTED'))
    `);
    await queryRunner.query(`
      ALTER TABLE "finance"."withdrawal_request"
        DROP COLUMN "overdue_notified_at",
        DROP COLUMN "payout_note",
        DROP COLUMN "payout_resolved_by",
        DROP COLUMN "failed_at",
        DROP COLUMN "fail_reason",
        DROP COLUMN "payout_checked_at",
        DROP COLUMN "payout_sent_at",
        DROP COLUMN "payout_ref",
        DROP COLUMN "card_mask",
        DROP COLUMN "card_token_cipher",
        DROP COLUMN "payout_card_id",
        DROP COLUMN "payout_mode"
    `);
    await queryRunner.query(`DROP TABLE "finance"."payout_card_session"`);
    await queryRunner.query(`DROP TABLE "finance"."payout_card"`);
  }
}
