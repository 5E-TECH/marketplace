import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuestFavorites1724500800000 implements MigrationInterface {
  name = 'AddGuestFavorites1724500800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE catalog.favorite ADD COLUMN IF NOT EXISTS session_id VARCHAR(128)`,
    );
    await q.query(
      `ALTER TABLE catalog.favorite ALTER COLUMN user_id DROP NOT NULL`,
    );
    await q.query(
      `ALTER TABLE catalog.favorite DROP CONSTRAINT IF EXISTS uq_catalog_favorite_user_product`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_favorite_user_product
       ON catalog.favorite(user_id, product_id) WHERE user_id IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_favorite_session_product
       ON catalog.favorite(session_id, product_id) WHERE session_id IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_catalog_favorite_session_created
       ON catalog.favorite(session_id, created_at DESC)`,
    );
    await q.query(
      `ALTER TABLE catalog.favorite
       ADD CONSTRAINT chk_catalog_favorite_owner
       CHECK ((user_id IS NOT NULL)::int + (session_id IS NOT NULL)::int = 1)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE catalog.favorite DROP CONSTRAINT IF EXISTS chk_catalog_favorite_owner`,
    );
    await q.query(`DELETE FROM catalog.favorite WHERE user_id IS NULL`);
    await q.query(
      `DROP INDEX IF EXISTS catalog.idx_catalog_favorite_session_created`,
    );
    await q.query(
      `DROP INDEX IF EXISTS catalog.uq_catalog_favorite_session_product`,
    );
    await q.query(
      `DROP INDEX IF EXISTS catalog.uq_catalog_favorite_user_product`,
    );
    await q.query(
      `ALTER TABLE catalog.favorite ALTER COLUMN user_id SET NOT NULL`,
    );
    await q.query(
      `ALTER TABLE catalog.favorite DROP COLUMN IF EXISTS session_id`,
    );
    await q.query(
      `ALTER TABLE catalog.favorite
       ADD CONSTRAINT uq_catalog_favorite_user_product UNIQUE(user_id, product_id)`,
    );
  }
}
