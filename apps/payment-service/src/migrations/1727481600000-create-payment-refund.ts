import { MigrationInterface, QueryRunner } from 'typeorm';

/** C4.2 — qaytarish so'rovlari uchun qisman refund yozuvlari. */
export class CreatePaymentRefund1727481600000 implements MigrationInterface {
  name = 'CreatePaymentRefund1727481600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS payment.payment_refund (
        id BIGSERIAL PRIMARY KEY,
        payment_id BIGINT NOT NULL REFERENCES payment.payment(id),
        amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
        reason TEXT NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_payment_refund_payment
         ON payment.payment_refund (payment_id)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS payment.payment_refund');
  }
}
