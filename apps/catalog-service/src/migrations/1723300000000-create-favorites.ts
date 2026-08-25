import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFavorites1723300000000 implements MigrationInterface {
  name = 'CreateFavorites1723300000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS catalog.favorite (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      product_id BIGINT NOT NULL REFERENCES catalog.product(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_catalog_favorite_user_product UNIQUE(user_id, product_id)
    )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_catalog_favorite_user_created ON catalog.favorite(user_id, created_at DESC)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS catalog.favorite');
  }
}
