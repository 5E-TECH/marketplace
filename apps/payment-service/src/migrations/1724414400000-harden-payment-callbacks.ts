import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenPaymentCallbacks1724414400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE payment.provider_config ADD COLUMN service_id VARCHAR(255)`,
    );
    // Previous Click configuration used merchant_id to store the service ID.
    await q.query(
      `UPDATE payment.provider_config SET service_id=merchant_id WHERE provider='CLICK'`,
    );
    await q.query(
      `ALTER TABLE payment.payment_transaction ADD COLUMN provider VARCHAR(10), ADD COLUMN provider_time BIGINT`,
    );
    await q.query(`UPDATE payment.payment_transaction t SET provider=p.provider,
      provider_time=CASE WHEN p.provider='PAYME' AND t.raw->>'time' ~ '^[0-9]{1,15}$'
        THEN (t.raw->>'time')::bigint ELSE t.create_time END
      FROM payment.payment p WHERE p.id=t.payment_id`);
    await q.query(
      `ALTER TABLE payment.payment_transaction ALTER COLUMN provider SET NOT NULL, ALTER COLUMN provider_time SET NOT NULL`,
    );
    await q.query(`DROP INDEX payment.uq_payment_transaction_provider_txn`);
    await q.query(
      `CREATE UNIQUE INDEX uq_payment_transaction_provider_txn ON payment.payment_transaction(provider,provider_txn_id) WHERE provider_txn_id IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX idx_payment_transaction_provider_time ON payment.payment_transaction(provider,provider_time)`,
    );
    await q.query(`CREATE TABLE payment.outbox_event (
      id BIGSERIAL PRIMARY KEY, aggregate_type VARCHAR(100) NOT NULL,
      aggregate_id VARCHAR(100) NOT NULL, event_type VARCHAR(100) NOT NULL,
      payload JSONB NOT NULL, status VARCHAR(15) NOT NULL DEFAULT 'PENDING',
      processed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE(aggregate_type,aggregate_id,event_type))`);
    await q.query(
      `CREATE INDEX idx_payment_outbox_pending ON payment.outbox_event(status,created_at)`,
    );
    // Recover PAID rows from the old save-then-emit implementation. Checkout
    // accepts repeats for already confirmed orders, so replay is intentional.
    await q.query(`INSERT INTO payment.outbox_event(aggregate_type,aggregate_id,event_type,payload)
      SELECT 'Payment',id::text,'payment.paid',jsonb_build_object(
        'paymentId',id::text,'salesOrderId',sales_order_id::text,'provider',provider,
        'amount',amount,'paidAt',COALESCE(paid_at,updated_at))
      FROM payment.payment WHERE status='PAID'`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE payment.outbox_event`);
    await q.query(`DROP INDEX payment.uq_payment_transaction_provider_txn`);
    // Fails safely if the old globally unique IDs no longer fit existing data.
    await q.query(
      `CREATE UNIQUE INDEX uq_payment_transaction_provider_txn ON payment.payment_transaction(provider_txn_id) WHERE provider_txn_id IS NOT NULL`,
    );
    await q.query(
      `ALTER TABLE payment.payment_transaction DROP COLUMN provider, DROP COLUMN provider_time`,
    );
    await q.query(`ALTER TABLE payment.provider_config DROP COLUMN service_id`);
  }
}
