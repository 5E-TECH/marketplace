import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateElchiWebhookEvent1724587200000 implements MigrationInterface {
  name = 'CreateElchiWebhookEvent1724587200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS checkout.elchi_webhook_event (
      event_id VARCHAR(128) PRIMARY KEY,
      shipment_id BIGINT NOT NULL,
      sales_order_seller_id BIGINT NOT NULL REFERENCES checkout.sales_order_seller(id),
      status VARCHAR(20) NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS checkout.elchi_webhook_event');
  }
}
