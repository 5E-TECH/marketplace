import { MigrationInterface, QueryRunner } from 'typeorm';

const JOURNAL_KINDS_OLD = `'ORDER_DELIVERED','ORDER_REFUSED','ORDER_REVERSAL','ELCHI_SETTLEMENT'`;
const LINE_KINDS_OLD = `'WHOLESALER_BASE','AFFILIATE_FEE','AFFILIATE_MARKUP','CALL_CENTER_FEE',
           'PLATFORM_SERVICE','PLATFORM_MARKUP','HIDDEN_DELIVERY','REFUSAL_FEE',
           'COD_RECEIVABLE','ELCHI_KEPT'`;

/**
 * BE-23 (MOL-5, SOT-7): sotuvchining pul yechish so‘rovlari.
 * - withdrawal_request — So‘raldi → Tasdiqlandi → To‘landi / Rad etildi; summa, 1% soliq va kartaga tushadigani.
 *   Kuniga bitta so‘rov (Toshkent kuni): rad etilgani hisobga olinmaydi [taklif].
 * - withdrawal_approval — kim tasdiqladi (5 mln dan katta — ikki xil xodim).
 * - affiliate_payout_profile — o‘zini o‘zi band qilganlik belgisi; moliya qo‘lda qo‘yadi (T01:471, karta [taklif]).
 * - ledger: «To‘landi» da WITHDRAWAL_PAID jurnali (AFFILIATE −summa, TAX +soliq, COD_CLEARING +kartaga);
 *   bu jurnalda buyurtma yo‘q, shuning uchun journal.order_id faqat shu tur uchun bo‘sh bo‘lishi mumkin.
 * - finance.setting: withdrawal_min = 50 000 (karta; ADM-2 da sozlama — T01:388).
 */
export class CreateWithdrawal1795651200000 implements MigrationInterface {
  name = 'CreateWithdrawal1795651200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance"."journal"
        DROP CONSTRAINT "chk_finance_journal_kind",
        ADD CONSTRAINT "chk_finance_journal_kind" CHECK ("kind" IN (${JOURNAL_KINDS_OLD},'WITHDRAWAL_PAID')),
        ALTER COLUMN "order_id" DROP NOT NULL,
        ADD CONSTRAINT "chk_finance_journal_order" CHECK ("order_id" IS NOT NULL OR "kind" = 'WITHDRAWAL_PAID')
    `);
    await queryRunner.query(`
      ALTER TABLE "finance"."ledger_entry"
        DROP CONSTRAINT "chk_finance_entry_line_kind",
        ADD CONSTRAINT "chk_finance_entry_line_kind" CHECK ("line_kind" IN
          (${LINE_KINDS_OLD},'WITHDRAWAL','WITHDRAWAL_TAX','WITHDRAWAL_NET'))
    `);
    await queryRunner.query(`
      CREATE TABLE "finance"."withdrawal_request" (
        "id" BIGSERIAL PRIMARY KEY,
        "affiliate_id" VARCHAR(64) NOT NULL,
        "amount" BIGINT NOT NULL,
        "tax_amount" BIGINT NOT NULL,
        "net_amount" BIGINT NOT NULL,
        "status" VARCHAR(12) NOT NULL DEFAULT 'REQUESTED',
        "required_approvals" SMALLINT NOT NULL,
        "request_day" DATE NOT NULL,
        "reject_reason" VARCHAR(500),
        "rejected_by" VARCHAR(64),
        "rejected_at" TIMESTAMPTZ,
        "approved_at" TIMESTAMPTZ,
        "paid_by" VARCHAR(64),
        "paid_at" TIMESTAMPTZ,
        "journal_id" BIGINT REFERENCES "finance"."journal"("id"),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_finance_withdrawal_status"
          CHECK ("status" IN ('REQUESTED','APPROVED','PAID','REJECTED')),
        CONSTRAINT "chk_finance_withdrawal_amount" CHECK ("amount" > 0 AND "tax_amount" >= 0 AND "net_amount" > 0),
        CONSTRAINT "chk_finance_withdrawal_sum" CHECK ("tax_amount" + "net_amount" = "amount"),
        CONSTRAINT "chk_finance_withdrawal_approvals" CHECK ("required_approvals" IN (1, 2)),
        CONSTRAINT "chk_finance_withdrawal_rejected"
          CHECK ("status" <> 'REJECTED' OR ("reject_reason" IS NOT NULL AND "rejected_at" IS NOT NULL)),
        CONSTRAINT "chk_finance_withdrawal_paid"
          CHECK ("status" <> 'PAID' OR ("paid_at" IS NOT NULL AND "journal_id" IS NOT NULL))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_finance_withdrawal_daily" ON "finance"."withdrawal_request" ("affiliate_id", "request_day")
      WHERE "status" <> 'REJECTED'
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_finance_withdrawal_affiliate" ON "finance"."withdrawal_request" ("affiliate_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_finance_withdrawal_status" ON "finance"."withdrawal_request" ("status", "created_at")`,
    );
    await queryRunner.query(`
      CREATE TABLE "finance"."withdrawal_approval" (
        "request_id" BIGINT NOT NULL REFERENCES "finance"."withdrawal_request"("id"),
        "approver_id" VARCHAR(64) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_finance_withdrawal_approval" PRIMARY KEY ("request_id", "approver_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "finance"."affiliate_payout_profile" (
        "affiliate_id" VARCHAR(64) PRIMARY KEY,
        "self_employed" BOOLEAN NOT NULL DEFAULT false,
        "updated_by" VARCHAR(64) NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      INSERT INTO "finance"."setting" ("key", "value", "effective_from", "changed_by")
      VALUES ('withdrawal_min', 50000, '2026-01-01T00:00:00Z', 'migration BE-23')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "finance"."setting" WHERE "key" = 'withdrawal_min'`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "finance"."affiliate_payout_profile"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "finance"."withdrawal_approval"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "finance"."withdrawal_request"`,
    );
    // Pul yechish jurnallari bo‘lsa, eski CHECK lar qayta qo‘yilmaydi (down xato beradi) — pul yozuvi o‘chirilmaydi.
    await queryRunner.query(`
      ALTER TABLE "finance"."ledger_entry"
        DROP CONSTRAINT "chk_finance_entry_line_kind",
        ADD CONSTRAINT "chk_finance_entry_line_kind" CHECK ("line_kind" IN (${LINE_KINDS_OLD}))
    `);
    await queryRunner.query(`
      ALTER TABLE "finance"."journal"
        DROP CONSTRAINT "chk_finance_journal_order",
        ALTER COLUMN "order_id" SET NOT NULL,
        DROP CONSTRAINT "chk_finance_journal_kind",
        ADD CONSTRAINT "chk_finance_journal_kind" CHECK ("kind" IN (${JOURNAL_KINDS_OLD}))
    `);
  }
}
