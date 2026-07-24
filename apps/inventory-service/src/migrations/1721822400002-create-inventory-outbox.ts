import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryOutbox1721822400002 implements MigrationInterface {
  name = 'CreateInventoryOutbox1721822400002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inventory"."outbox_event" (
        "id" BIGSERIAL NOT NULL,
        "aggregate_type" VARCHAR(100) NOT NULL,
        "aggregate_id" VARCHAR(100) NOT NULL,
        "event_type" VARCHAR(100) NOT NULL,
        "payload" JSONB NOT NULL,
        "status" VARCHAR(15) NOT NULL DEFAULT 'PENDING',
        "processed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_inventory_outbox_event" PRIMARY KEY ("id"),
        CONSTRAINT "chk_inventory_outbox_event_status"
          CHECK ("status" IN ('PENDING', 'PROCESSED', 'FAILED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_inventory_outbox_event_status_created"
      ON "inventory"."outbox_event" ("status", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "inventory"."outbox_event"`);
  }
}
