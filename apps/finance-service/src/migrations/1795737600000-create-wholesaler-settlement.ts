import { MigrationInterface, QueryRunner } from 'typeorm';

const JOURNAL_KINDS = `'ORDER_DELIVERED','ORDER_REFUSED','ORDER_REVERSAL','ELCHI_SETTLEMENT','WITHDRAWAL_PAID'`;
const LINE_KINDS = `'WHOLESALER_BASE','AFFILIATE_FEE','AFFILIATE_MARKUP','CALL_CENTER_FEE',
           'PLATFORM_SERVICE','PLATFORM_MARKUP','HIDDEN_DELIVERY','REFUSAL_FEE',
           'COD_RECEIVABLE','ELCHI_KEPT','WITHDRAWAL','WITHDRAWAL_TAX','WITHDRAWAL_NET'`;

/**
 * BE-33 (MOL-7, T01:117): optovik bilan haftalik hisob-kitob va akt-sverka.
 * - wholesaler_settlement — optovik + davr (dushanba–yakshanba) bo‘yicha akt; READY → PAID.
 * - wholesaler_settlement_item — aktga kirgan WHOLESALER_BASE yozuvi; entry_id UNIQUE — bir qator ikki marta to‘lanmaydi.
 * - ledger: «To‘landi» da WHOLESALER_PAID jurnali (WHOLESALER −summa, COD_CLEARING +summa); buyurtmasiz.
 * Qaytarish muddati (`finance.setting.return_window_days`) bu migratsiyada QO‘YILMAYDI: qiymat EQ-10 da (manbasiz
 * sukut yo‘q) — sozlanmaguncha akt tuzilmaydi.
 */
export class CreateWholesalerSettlement1795737600000 implements MigrationInterface {
  name = 'CreateWholesalerSettlement1795737600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance"."journal"
        DROP CONSTRAINT "chk_finance_journal_kind",
        ADD CONSTRAINT "chk_finance_journal_kind" CHECK ("kind" IN (${JOURNAL_KINDS},'WHOLESALER_PAID')),
        DROP CONSTRAINT "chk_finance_journal_order",
        ADD CONSTRAINT "chk_finance_journal_order"
          CHECK ("order_id" IS NOT NULL OR "kind" IN ('WITHDRAWAL_PAID','WHOLESALER_PAID'))
    `);
    await queryRunner.query(`
      ALTER TABLE "finance"."ledger_entry"
        DROP CONSTRAINT "chk_finance_entry_line_kind",
        ADD CONSTRAINT "chk_finance_entry_line_kind" CHECK ("line_kind" IN (${LINE_KINDS},'WHOLESALER_PAYOUT'))
    `);
    await queryRunner.query(`
      CREATE TABLE "finance"."wholesaler_settlement" (
        "id" BIGSERIAL PRIMARY KEY,
        "wholesaler_id" VARCHAR(64) NOT NULL,
        "period_start" DATE NOT NULL,
        "period_end" DATE NOT NULL,
        "return_window_days" INTEGER NOT NULL,
        "status" VARCHAR(10) NOT NULL DEFAULT 'READY',
        "total_amount" BIGINT NOT NULL DEFAULT 0,
        "paid_by" VARCHAR(64),
        "paid_at" TIMESTAMPTZ,
        "journal_id" BIGINT REFERENCES "finance"."journal"("id"),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_finance_settlement_status" CHECK ("status" IN ('READY','PAID')),
        CONSTRAINT "chk_finance_settlement_total" CHECK ("total_amount" >= 0),
        CONSTRAINT "chk_finance_settlement_paid"
          CHECK ("status" <> 'PAID' OR ("paid_at" IS NOT NULL AND "journal_id" IS NOT NULL)),
        CONSTRAINT "uq_finance_settlement_period" UNIQUE ("wholesaler_id", "period_end")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "finance"."wholesaler_settlement_item" (
        "id" BIGSERIAL PRIMARY KEY,
        "settlement_id" BIGINT NOT NULL REFERENCES "finance"."wholesaler_settlement"("id"),
        "entry_id" BIGINT NOT NULL REFERENCES "finance"."ledger_entry"("id"),
        "order_id" VARCHAR(64) NOT NULL,
        "product_id" VARCHAR(64),
        "quantity" INTEGER,
        "amount" BIGINT NOT NULL,
        "delivered_at" TIMESTAMPTZ NOT NULL,
        CONSTRAINT "uq_finance_settlement_item_entry" UNIQUE ("entry_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_finance_settlement_item_settlement" ON "finance"."wholesaler_settlement_item" ("settlement_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "finance"."wholesaler_settlement_item"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "finance"."wholesaler_settlement"`,
    );
    await queryRunner.query(`
      ALTER TABLE "finance"."ledger_entry"
        DROP CONSTRAINT "chk_finance_entry_line_kind",
        ADD CONSTRAINT "chk_finance_entry_line_kind" CHECK ("line_kind" IN (${LINE_KINDS}))
    `);
    await queryRunner.query(`
      ALTER TABLE "finance"."journal"
        DROP CONSTRAINT "chk_finance_journal_order",
        ADD CONSTRAINT "chk_finance_journal_order" CHECK ("order_id" IS NOT NULL OR "kind" = 'WITHDRAWAL_PAID'),
        DROP CONSTRAINT "chk_finance_journal_kind",
        ADD CONSTRAINT "chk_finance_journal_kind" CHECK ("kind" IN (${JOURNAL_KINDS}))
    `);
  }
}
