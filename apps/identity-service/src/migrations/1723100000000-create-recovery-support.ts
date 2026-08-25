import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRecoverySupport1723100000000 implements MigrationInterface {
  name = 'CreateRecoverySupport1723100000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ`,
    );
    await q.query(`CREATE TABLE IF NOT EXISTS identity.verification_code (
      id UUID PRIMARY KEY, phone VARCHAR(20) NOT NULL, purpose VARCHAR(30) NOT NULL,
      code_hash VARCHAR(64) NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_verification_phone_purpose ON identity.verification_code(phone, purpose, created_at DESC)`,
    );
    await q.query(`CREATE TABLE IF NOT EXISTS identity.support_ticket (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL, subject VARCHAR(200) NOT NULL,
      order_id BIGINT, status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_support_ticket_user ON identity.support_ticket(user_id, created_at DESC)`,
    );
    await q.query(`CREATE TABLE IF NOT EXISTS identity.support_message (
      id BIGSERIAL PRIMARY KEY, ticket_id BIGINT NOT NULL REFERENCES identity.support_ticket(id) ON DELETE CASCADE,
      sender_user_id BIGINT NOT NULL, message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS identity.support_message');
    await q.query('DROP TABLE IF EXISTS identity.support_ticket');
    await q.query('DROP TABLE IF EXISTS identity.verification_code');
    await q.query(
      'ALTER TABLE identity.users DROP COLUMN IF EXISTS phone_verified_at',
    );
  }
}
