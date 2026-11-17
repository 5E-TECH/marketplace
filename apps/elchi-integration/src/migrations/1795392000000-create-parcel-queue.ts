import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-20 (TZ 6.7 ELC-1, ELC-2, ELC-6; T9-4): posilka buyurtma tranzaksiyasidan
 * tashqarida, navbat orqali yaratiladi.
 *  - parcel_request: buyurtma bo'yicha bitta qator (order_id UNIQUE — TC1),
 *    qayta urinish jadvali va Elchi natijasi;
 *  - outbox_event: `elchi.parcel.*` hodisalari (BE-03 relay);
 *  - processed_event: `order.status.changed` takrorini tashlash (BE-03).
 */
export class CreateParcelQueue1795392000000 implements MigrationInterface {
  name = 'CreateParcelQueue1795392000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "integration"."parcel_request" (
        "id" BIGSERIAL NOT NULL,
        "order_id" VARCHAR(100) NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        "payload" JSONB NOT NULL,
        "shipment_id" TEXT,
        "qr_code_token" TEXT,
        "tracking_url" TEXT,
        "to_be_paid" BIGINT,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "last_error" TEXT,
        "last_create_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_integration_parcel_request" PRIMARY KEY ("id"),
        CONSTRAINT "uq_integration_parcel_request_order" UNIQUE ("order_id"),
        CONSTRAINT "chk_integration_parcel_request_status" CHECK ("status" IN
          ('PENDING', 'CREATED', 'FAILED', 'CANCEL_PENDING', 'CANCELLED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_integration_parcel_request_due"
      ON "integration"."parcel_request" ("next_attempt_at", "id")
      WHERE "status" IN ('PENDING', 'CANCEL_PENDING')
    `);
    await queryRunner.query(`
      CREATE TABLE "integration"."outbox_event" (
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
        CONSTRAINT "pk_integration_outbox_event" PRIMARY KEY ("id"),
        CONSTRAINT "chk_integration_outbox_event_status"
          CHECK ("status" IN ('PENDING', 'PROCESSED', 'FAILED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_integration_outbox_event_status_id"
      ON "integration"."outbox_event" ("status", "id")
    `);
    // `processedEventTableSql('integration')` bilan bir xil — migratsiya
    // keyinchalik o'zgarmasligi uchun SQL shu yerda yozilgan.
    await queryRunner.query(`
      CREATE TABLE "integration"."processed_event" (
        "consumer" VARCHAR(100) NOT NULL,
        "event_id" VARCHAR(200) NOT NULL,
        "processed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_integration_processed_event" PRIMARY KEY ("consumer", "event_id")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "integration"."processed_event"`);
    await queryRunner.query(`DROP TABLE "integration"."outbox_event"`);
    await queryRunner.query(`DROP TABLE "integration"."parcel_request"`);
  }
}
