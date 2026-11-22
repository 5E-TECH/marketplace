import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-21 (TZ ELC-3 «har webhook jurnalda»): webhook natijasi ham saqlanadi — qo‘llandi, o‘zgarishsiz, rad etildi
 * (orqaga yoki ruxsatsiz), e’tiborsiz. Lid buyurtmasi raqami — admin jurnali va sverka uchun.
 */
export class ElchiWebhookResult1796601600000 implements MigrationInterface {
  name = 'ElchiWebhookResult1796601600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE checkout.elchi_webhook_event
      ADD COLUMN result VARCHAR(16) NOT NULL DEFAULT 'APPLIED',
      ADD COLUMN detail TEXT,
      ADD COLUMN order_id BIGINT REFERENCES checkout.sales_order(id),
      ADD CONSTRAINT chk_elchi_webhook_event_result
        CHECK (result IN ('APPLIED','NOOP','REJECTED','IGNORED'))`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_elchi_webhook_event_order
      ON checkout.elchi_webhook_event (order_id, processed_at) WHERE order_id IS NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'DROP INDEX IF EXISTS checkout.idx_elchi_webhook_event_order',
    );
    await q.query(`ALTER TABLE checkout.elchi_webhook_event
      DROP CONSTRAINT IF EXISTS chk_elchi_webhook_event_result,
      DROP COLUMN IF EXISTS order_id,
      DROP COLUMN IF EXISTS detail,
      DROP COLUMN IF EXISTS result`);
  }
}
