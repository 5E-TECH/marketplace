import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationTables1722686400000 implements MigrationInterface {
  name = 'CreateNotificationTables1722686400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification"."notification" (
        "id" BIGSERIAL PRIMARY KEY,
        "user_id" BIGINT NOT NULL,
        "type" VARCHAR(50) NOT NULL,
        "title" VARCHAR(255) NOT NULL,
        "body" TEXT NOT NULL,
        "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "is_read" BOOLEAN NOT NULL DEFAULT FALSE,
        "read_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_user_created"
      ON "notification"."notification" ("user_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification"."notification_delivery" (
        "id" BIGSERIAL PRIMARY KEY,
        "notification_id" BIGINT NOT NULL
          REFERENCES "notification"."notification"("id") ON DELETE CASCADE,
        "channel" VARCHAR(15) NOT NULL,
        "recipient" VARCHAR(255),
        "status" VARCHAR(15) NOT NULL DEFAULT 'PENDING',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "next_retry_at" TIMESTAMPTZ,
        "last_error" TEXT,
        "sent_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_notification_delivery_channel"
          UNIQUE ("notification_id", "channel")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_delivery_retry"
      ON "notification"."notification_delivery" ("status", "next_retry_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "notification"."notification_delivery"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "notification"."notification"`,
    );
  }
}
