import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCodReconciliation1724932800000 implements MigrationInterface {
  name = 'CreateCodReconciliation1724932800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE finance.seller_ledger DROP CONSTRAINT IF EXISTS chk_finance_ledger_type`,
    );
    await q.query(`ALTER TABLE finance.seller_ledger ADD CONSTRAINT chk_finance_ledger_type CHECK
      (entry_type IN ('SALE','COD_SALE','COD_SETTLEMENT','COMMISSION','PAYOUT','REFUND','ADJUST'))`);
    await q.query(`CREATE TABLE IF NOT EXISTS finance.cod_reconciliation (
      id BIGSERIAL PRIMARY KEY,
      event_id VARCHAR(128) NOT NULL UNIQUE,
      seller_order_id BIGINT NOT NULL UNIQUE,
      sales_order_id BIGINT NOT NULL,
      shop_id BIGINT NOT NULL,
      expected_cod_amount NUMERIC(14,2) NOT NULL,
      collected_cod_amount NUMERIC(14,2) NOT NULL,
      commission_amount NUMERIC(14,2) NOT NULL,
      netted_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      settled_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_finance_cod_recon_shop_settled
      ON finance.cod_reconciliation(shop_id,settled_at DESC)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS finance.cod_reconciliation`);
    await q.query(
      `ALTER TABLE finance.seller_ledger DROP CONSTRAINT IF EXISTS chk_finance_ledger_type`,
    );
    await q.query(`ALTER TABLE finance.seller_ledger ADD CONSTRAINT chk_finance_ledger_type CHECK
      (entry_type IN ('SALE','COMMISSION','PAYOUT','REFUND','ADJUST'))`);
  }
}
