import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * C1.31 — Admin audit log (o'zgarmas tarix). Xavfli admin amallari (shop
 * approve/reject, user block/unblock, rol o'zgarishi) shu jadvalga yoziladi:
 * kim (actor_id), nima (action), qaysi resurs (entity_type/id), old→new+ip
 * (meta jsonb), vaqt (created_at). Faqat qo'shiladi — tahrir/o'chirish YO'Q
 * (ActivityLogService faqat `log()` beradi). Gateway barcha admin write'dan
 * so'ng `identity.audit.log` orqali yozadi (actor+ip gatewayда ma'lum).
 */
export class CreateActivityLog1722950000002 implements MigrationInterface {
  name = 'CreateActivityLog1722950000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "identity"."activity_log" (
        "id" BIGSERIAL PRIMARY KEY,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        "actor_id" BIGINT,
        "action" VARCHAR(100) NOT NULL,
        "entity_type" VARCHAR(100),
        "entity_id" VARCHAR(100),
        "meta" JSONB
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activity_log_entity"
      ON "identity"."activity_log" ("entity_type", "entity_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "identity"."activity_log" CASCADE`,
    );
  }
}
