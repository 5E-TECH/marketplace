import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-22 (TZ 6.8 MOL-1…MOL-4, T4 finance jadvallari, T8 «Pul»): ko'p tomonli
 * hisoblar va ikki tomonlama yozuvlar. Pul — BIGINT, butun so'm (BE-01).
 *
 * - account: PLATFORM_SERVICE, CALL_CENTER, WHOLESALER, AFFILIATE, ELCHI, TAX
 *   (T4) va COD_CLEARING [taklif: mijoz naqd puli Elchi da turgan qarshi hisob].
 *   Egasi bor hisoblar (optovik, sotuvchi) — owner_id bilan.
 * - journal: bitta biznes fakti (yetkazildi, rad, qaytarish, Elchi o'tkazmasi) —
 *   yozuvlari yig'indisi 0; (kind, reference_id) unikal — takroriy hodisa
 *   ikkinchi taqsimot yozmaydi (TC5).
 * - ledger_entry: HOLD → AVAILABLE → REVERSED (T4).
 * - elchi_remittance, remittance_item: Elchi o'tkazmasi va sverka (T4).
 * - balance_check: kechki tekshiruv natijasi (qabul mezoni: farq 0).
 * - setting: rad to'lovi 20 000 (6-qaror, MOL-3; ADM-2 sozlamasi).
 * Eski jadvallar (seller_ledger, payout, …) tegilmaydi.
 */
export class CreateLedger1795478400000 implements MigrationInterface {
  name = 'CreateLedger1795478400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "finance"."account" (
        "id" BIGSERIAL PRIMARY KEY,
        "type" VARCHAR(20) NOT NULL,
        "owner_id" VARCHAR(64) NOT NULL DEFAULT '',
        "hold_balance" BIGINT NOT NULL DEFAULT 0,
        "available_balance" BIGINT NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_finance_account_type" CHECK ("type" IN
          ('PLATFORM_SERVICE','CALL_CENTER','WHOLESALER','AFFILIATE','ELCHI','TAX','COD_CLEARING')),
        CONSTRAINT "chk_finance_account_owner"
          CHECK (("type" IN ('WHOLESALER','AFFILIATE')) = ("owner_id" <> '')),
        CONSTRAINT "uq_finance_account_type_owner" UNIQUE ("type", "owner_id")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "finance"."account" ("type") VALUES
        ('PLATFORM_SERVICE'), ('CALL_CENTER'), ('ELCHI'), ('TAX'), ('COD_CLEARING')
    `);
    await queryRunner.query(`
      CREATE TABLE "finance"."journal" (
        "id" BIGSERIAL PRIMARY KEY,
        "kind" VARCHAR(20) NOT NULL,
        "reference_id" VARCHAR(255) NOT NULL,
        "order_id" VARCHAR(64) NOT NULL,
        "order_number" VARCHAR(32),
        "lead_id" VARCHAR(64),
        "stream_id" VARCHAR(64),
        "affiliate_id" VARCHAR(64),
        "source" VARCHAR(10),
        "gross_amount" BIGINT NOT NULL,
        "event_id" VARCHAR(200) NOT NULL,
        "reverses_journal_id" BIGINT REFERENCES "finance"."journal"("id"),
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_finance_journal_kind" CHECK ("kind" IN
          ('ORDER_DELIVERED','ORDER_REFUSED','ORDER_REVERSAL','ELCHI_SETTLEMENT')),
        CONSTRAINT "uq_finance_journal_reference" UNIQUE ("kind", "reference_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_finance_journal_order" ON "finance"."journal" ("order_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "finance"."ledger_entry" (
        "id" BIGSERIAL PRIMARY KEY,
        "journal_id" BIGINT NOT NULL REFERENCES "finance"."journal"("id"),
        "account_id" BIGINT NOT NULL REFERENCES "finance"."account"("id"),
        "line_kind" VARCHAR(20) NOT NULL,
        "item_seq" SMALLINT NOT NULL DEFAULT 0,
        "product_id" VARCHAR(64),
        "amount" BIGINT NOT NULL,
        "state" VARCHAR(10) NOT NULL,
        "reverses_entry_id" BIGINT REFERENCES "finance"."ledger_entry"("id"),
        "available_at" TIMESTAMPTZ,
        "reversed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_finance_entry_amount" CHECK ("amount" <> 0),
        CONSTRAINT "chk_finance_entry_state" CHECK ("state" IN ('HOLD','AVAILABLE','REVERSED')),
        CONSTRAINT "chk_finance_entry_line_kind" CHECK ("line_kind" IN
          ('WHOLESALER_BASE','AFFILIATE_FEE','AFFILIATE_MARKUP','CALL_CENTER_FEE',
           'PLATFORM_SERVICE','PLATFORM_MARKUP','HIDDEN_DELIVERY','REFUSAL_FEE',
           'COD_RECEIVABLE','ELCHI_KEPT')),
        CONSTRAINT "uq_finance_entry_line" UNIQUE ("journal_id", "account_id", "line_kind", "item_seq")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_finance_entry_account" ON "finance"."ledger_entry" ("account_id", "created_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_finance_entry_journal" ON "finance"."ledger_entry" ("journal_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "finance"."elchi_remittance" (
        "id" BIGSERIAL PRIMARY KEY,
        "event_id" VARCHAR(200) NOT NULL UNIQUE,
        "payload" JSONB NOT NULL,
        "received_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "finance"."remittance_item" (
        "id" BIGSERIAL PRIMARY KEY,
        "remittance_id" BIGINT NOT NULL REFERENCES "finance"."elchi_remittance"("id"),
        "order_id" VARCHAR(64) NOT NULL,
        "shipment_id" VARCHAR(64),
        "elchi_status" VARCHAR(20) NOT NULL,
        "collected_from_customer" BIGINT,
        "elchi_fee" BIGINT,
        "market_paid_amount" BIGINT,
        "refusal_fee" BIGINT,
        "expected_amount" BIGINT,
        "diff" BIGINT,
        "match_state" VARCHAR(10) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_finance_remittance_match" CHECK ("match_state" IN
          ('PENDING','MATCHED','PARTIAL','MISMATCH'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_finance_remittance_order" ON "finance"."remittance_item" ("order_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "finance"."balance_check" (
        "id" BIGSERIAL PRIMARY KEY,
        "started_at" TIMESTAMPTZ NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "ok" BOOLEAN NOT NULL,
        "diff_abs_total" BIGINT NOT NULL,
        "details" JSONB NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "finance"."setting" (
        "key" VARCHAR(40) NOT NULL,
        "value" BIGINT NOT NULL,
        "effective_from" TIMESTAMPTZ NOT NULL,
        "changed_by" VARCHAR(64),
        CONSTRAINT "pk_finance_setting" PRIMARY KEY ("key", "effective_from")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "finance"."setting" ("key", "value", "effective_from", "changed_by")
      VALUES ('refusal_fee', 20000, '2026-01-01T00:00:00Z', 'migration BE-22')
    `);
    await queryRunner.query(`
      CREATE TABLE "finance"."processed_event" (
        "consumer" VARCHAR(100) NOT NULL,
        "event_id" VARCHAR(200) NOT NULL,
        "processed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_finance_processed_event" PRIMARY KEY ("consumer", "event_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "finance"."event_failure" (
        "id" BIGSERIAL PRIMARY KEY,
        "consumer" VARCHAR(100) NOT NULL,
        "event_id" VARCHAR(200),
        "reason" TEXT NOT NULL,
        "payload" JSONB NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'event_failure',
      'processed_event',
      'setting',
      'balance_check',
      'remittance_item',
      'elchi_remittance',
      'ledger_entry',
      'journal',
      'account',
    ]) {
      await queryRunner.query(`DROP TABLE "finance"."${table}"`);
    }
  }
}
