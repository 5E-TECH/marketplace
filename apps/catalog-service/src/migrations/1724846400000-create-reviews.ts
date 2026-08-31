import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReviews1724846400000 implements MigrationInterface {
  name = 'CreateReviews1724846400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE catalog.product ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2) NOT NULL DEFAULT 0`,
    );
    await q.query(`CREATE TABLE IF NOT EXISTS catalog.review (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      order_item_id BIGINT NOT NULL,
      seller_order_id BIGINT NOT NULL,
      product_id BIGINT NOT NULL REFERENCES catalog.product(id) ON DELETE CASCADE,
      shop_id BIGINT NOT NULL REFERENCES catalog.shop(id) ON DELETE CASCADE,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_catalog_review_order_item UNIQUE(order_item_id)
    )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_catalog_review_product_created ON catalog.review(product_id,created_at DESC)`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_catalog_review_shop ON catalog.review(shop_id)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS catalog.review`);
    await q.query(`ALTER TABLE catalog.product DROP COLUMN IF EXISTS rating`);
  }
}
