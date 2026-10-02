import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTemplatesAndBroadcasts1727136000000 implements MigrationInterface {
  name = 'CreateTemplatesAndBroadcasts1727136000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // C6.8 — admin tahrirlagan shablonlar (standart matn kodda qoladi).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification"."notification_template" (
        "key" VARCHAR(50) PRIMARY KEY,
        "title" VARCHAR(255) NOT NULL,
        "body" TEXT NOT NULL,
        "updated_by" BIGINT,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    // C6.8 — ommaviy xabarlar tarixi va yuborish holati.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification"."broadcast" (
        "id" BIGSERIAL PRIMARY KEY,
        "audience" VARCHAR(10) NOT NULL,
        "channels" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "title" VARCHAR(255) NOT NULL,
        "body" TEXT NOT NULL,
        "recipients_count" INTEGER NOT NULL,
        "sent_count" INTEGER NOT NULL DEFAULT 0,
        "status" VARCHAR(10) NOT NULL DEFAULT 'QUEUED',
        "preview_token" VARCHAR(64) NOT NULL,
        "cursor" BIGINT,
        "created_by" BIGINT,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "last_error" TEXT,
        "finished_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_broadcast_preview_token" UNIQUE ("preview_token"),
        CONSTRAINT "chk_broadcast_audience"
          CHECK ("audience" IN ('all','sellers','buyers')),
        CONSTRAINT "chk_broadcast_status"
          CHECK ("status" IN ('QUEUED','SENDING','DONE','FAILED'))
      )`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_broadcast_status_updated"
        ON "notification"."broadcast" ("status","updated_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notification"."broadcast"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "notification"."notification_template"`,
    );
  }
}
