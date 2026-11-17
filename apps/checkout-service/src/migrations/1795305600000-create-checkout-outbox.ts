import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-03 (TZ T9-3): checkout hodisalari uchun outbox jadvali — inventory
 * outbox bilan bir xil tuzilish (`libs/common/src/outbox/outbox-event.entity.ts`).
 */
export class CreateCheckoutOutbox1795305600000 implements MigrationInterface {
  name = 'CreateCheckoutOutbox1795305600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "checkout"."outbox_event" (
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
        CONSTRAINT "pk_checkout_outbox_event" PRIMARY KEY ("id"),
        CONSTRAINT "chk_checkout_outbox_event_status"
          CHECK ("status" IN ('PENDING', 'PROCESSED', 'FAILED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_checkout_outbox_event_status_id"
      ON "checkout"."outbox_event" ("status", "id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "checkout"."outbox_event"`);
  }
}
