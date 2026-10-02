import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePayoutSchedule1727568000000 implements MigrationInterface {
  name = 'CreatePayoutSchedule1727568000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS finance.payout_schedule (
      id BIGSERIAL PRIMARY KEY,
      shop_id BIGINT NOT NULL,
      frequency VARCHAR(10) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_finance_payout_schedule_shop UNIQUE (shop_id),
      CONSTRAINT chk_finance_payout_schedule_frequency
        CHECK (frequency IN ('DAILY','WEEKLY','MONTHLY'))
    )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS finance.payout_schedule`);
  }
}
