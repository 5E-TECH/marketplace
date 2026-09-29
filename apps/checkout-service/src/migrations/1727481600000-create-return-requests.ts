import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * C4.2 — xaridorning qaytarish so'rovlari. Bitta so'rov = bitta posilka
 * (sales_order_seller): uni aynan shu do'kon sotuvchisi ko'rib chiqadi.
 * Tovar qatorlari miqdor bo'yicha (qisman qaytarish), har holat o'tishi
 * `return_request_history` ga yoziladi.
 */
export class CreateReturnRequests1727481600000 implements MigrationInterface {
  name = 'CreateReturnRequests1727481600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS checkout.return_request (
        id BIGSERIAL PRIMARY KEY,
        sales_order_id BIGINT NOT NULL REFERENCES checkout.sales_order(id),
        sales_order_seller_id BIGINT NOT NULL
          REFERENCES checkout.sales_order_seller(id),
        shop_id BIGINT NOT NULL,
        customer_id BIGINT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
        reason VARCHAR(30) NOT NULL,
        comment TEXT,
        requested_amount NUMERIC(14,2) NOT NULL,
        refunded_amount NUMERIC(14,2),
        restocked BOOLEAN,
        decision_comment TEXT,
        decided_by VARCHAR(64),
        decided_at TIMESTAMPTZ,
        refunded_by VARCHAR(64),
        refunded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_return_request_shop_status
         ON checkout.return_request (shop_id, status, created_at DESC)`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_return_request_customer
         ON checkout.return_request (customer_id, created_at DESC)`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_return_request_order
         ON checkout.return_request (sales_order_id)`,
    );
    await q.query(`
      CREATE TABLE IF NOT EXISTS checkout.return_request_item (
        id BIGSERIAL PRIMARY KEY,
        return_request_id BIGINT NOT NULL
          REFERENCES checkout.return_request(id),
        sales_order_item_id BIGINT NOT NULL
          REFERENCES checkout.sales_order_item(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(14,2) NOT NULL,
        line_total NUMERIC(14,2) NOT NULL
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_return_request_item_request
         ON checkout.return_request_item (return_request_id)`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_return_request_item_order_item
         ON checkout.return_request_item (sales_order_item_id)`,
    );
    await q.query(`
      CREATE TABLE IF NOT EXISTS checkout.return_request_history (
        id BIGSERIAL PRIMARY KEY,
        return_request_id BIGINT NOT NULL
          REFERENCES checkout.return_request(id),
        from_status VARCHAR(20),
        to_status VARCHAR(20) NOT NULL,
        actor_id VARCHAR(64),
        actor_role VARCHAR(20) NOT NULL,
        comment TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_return_request_history_request
         ON checkout.return_request_history (return_request_id, id)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS checkout.return_request_history');
    await q.query('DROP TABLE IF EXISTS checkout.return_request_item');
    await q.query('DROP TABLE IF EXISTS checkout.return_request');
  }
}
