import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-35 (ADM-4, TZ 7-bo‘lim): firibgarlik hodisalari va choralar tarixi.
 * - fraud_incident: bir qoida + obyekt uchun bitta ochiq hodisa (qisman unikal indeks).
 * - fraud_action: faqat qo‘shiladi — UPDATE va DELETE trigger bilan taqiqlangan (dizayn E-Admin-Firibgarlik:
 *   «Yozuvni o‘chirib bo‘lmaydi»; ADM-6 audit qoidasi bilan bir xil).
 * - stream.fraud_stopped_at: firibgarlik sababli to‘xtatilgan sahifa.
 * - Qizil ro‘yxat indeksi: navbatdagi yangi lidlar (holat + yaratilgan vaqt).
 */
export class AddFraudCenter1795824000000 implements MigrationInterface {
  name = 'AddFraudCenter1795824000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "lead"."fraud_incident" (
        "id" BIGSERIAL PRIMARY KEY,
        "rule" VARCHAR(24) NOT NULL,
        "status" VARCHAR(12) NOT NULL DEFAULT 'OPEN',
        "subject_key" VARCHAR(80) NOT NULL,
        "affiliate_id" BIGINT,
        "stream_id" BIGINT,
        "lead_id" BIGINT,
        "operator_id" BIGINT,
        "summary" TEXT NOT NULL,
        "evidence" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "proposed_action" VARCHAR(16),
        "detected_by" BIGINT,
        "detected_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "closed_at" TIMESTAMPTZ,
        "closed_by" BIGINT,
        CONSTRAINT "chk_lead_fraud_incident_status" CHECK ("status" IN ('OPEN','RESOLVED','DISMISSED'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_lead_fraud_incident_open" ON "lead"."fraud_incident" ("rule", "subject_key")
      WHERE "status" = 'OPEN'
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_fraud_incident_status_detected" ON "lead"."fraud_incident" ("status", "detected_at")
    `);
    await queryRunner.query(`
      CREATE TABLE "lead"."fraud_action" (
        "id" BIGSERIAL PRIMARY KEY,
        "incident_id" BIGINT REFERENCES "lead"."fraud_incident" ("id"),
        "action" VARCHAR(16) NOT NULL,
        "rule" VARCHAR(24),
        "target_type" VARCHAR(12) NOT NULL,
        "target_id" VARCHAR(64) NOT NULL,
        "affiliate_id" BIGINT,
        "reason" TEXT NOT NULL,
        "evidence" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "actor_id" BIGINT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_fraud_action_created" ON "lead"."fraud_action" ("created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_fraud_action_target" ON "lead"."fraud_action" ("target_type", "target_id")
    `);
    await queryRunner.query(`
      CREATE FUNCTION "lead"."fraud_action_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'fraud_action faqat qo‘shiladi: o‘zgartirish va o‘chirish taqiqlangan';
      END $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_lead_fraud_action_append_only"
      BEFORE UPDATE OR DELETE ON "lead"."fraud_action"
      FOR EACH ROW EXECUTE FUNCTION "lead"."fraud_action_append_only"()
    `);
    await queryRunner.query(`
      ALTER TABLE "lead"."stream" ADD COLUMN "fraud_stopped_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_queue_new" ON "lead"."lead" ("created_at")
      WHERE "status" = 'NEW' AND "is_deleted" = false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "lead"."idx_lead_lead_queue_new"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lead"."stream" DROP COLUMN IF EXISTS "fraud_stopped_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "lead"."fraud_action"`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "lead"."fraud_action_append_only"()`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "lead"."fraud_incident"`);
  }
}
