import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateOrderHistory1723200000000 implements MigrationInterface {
  name = 'CreateOrderHistory1723200000000';
  async up(q: QueryRunner) {
    await q.query(
      `CREATE TABLE IF NOT EXISTS checkout.sales_order_seller_history(id BIGSERIAL PRIMARY KEY,sales_order_seller_id BIGINT NOT NULL REFERENCES checkout.sales_order_seller(id),status VARCHAR(20) NOT NULL,comment TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE IF EXISTS checkout.sales_order_seller_history');
  }
}
