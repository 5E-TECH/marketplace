import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-15 (TZ T4 `call`, TEL-1–4): telefoniya. T4 da `telephony` sxemasi ko‘rsatilgan; jadval lead-service da, chunki
 * qo‘ng‘iroq lid urinishining qismi va boshqa servis uni o‘qimaydi [taklif].
 * - `operator_phone` — operatorning ichki raqami yoki mobili (provayder avval shunga qo‘ng‘iroq qiladi);
 * - `call` — qo‘ng‘iroq: bosqich, javob, davomiylik, tugash sababi, provayderdagi yozuv kaliti. Mijoz raqami — faqat xesh;
 * - `call_event` — provayder hodisalari takrorlanmasligi uchun.
 */
export class Telephony1798675200000 implements MigrationInterface {
  name = 'Telephony1798675200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "lead"."operator_phone" (
        "operator_id" BIGINT NOT NULL,
        "kind" VARCHAR(10) NOT NULL,
        "value" VARCHAR(20) NOT NULL,
        "updated_by" BIGINT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_lead_operator_phone" PRIMARY KEY ("operator_id"),
        CONSTRAINT "chk_lead_operator_phone" CHECK (
          ("kind" = 'EXTENSION' AND "value" ~ '^[0-9]{2,10}$')
          OR ("kind" = 'MOBILE' AND "value" ~ '^\\+998[0-9]{9}$'))
      )
    `);
    // bitta telefon — bitta operator: aks holda qo‘ng‘iroq boshqa odamga tushadi
    await q.query(`
      CREATE UNIQUE INDEX "uq_lead_operator_phone_value"
      ON "lead"."operator_phone" ("value")
    `);
    await q.query(`
      CREATE TABLE "lead"."call" (
        "id" BIGSERIAL NOT NULL,
        "ref" UUID NOT NULL,
        "lead_id" BIGINT NOT NULL,
        "operator_id" BIGINT NOT NULL,
        "attempt_id" BIGINT,
        "direction" VARCHAR(3) NOT NULL DEFAULT 'OUT',
        "channel" VARCHAR(10) NOT NULL,
        "platform_number" VARCHAR(20),
        "customer_phone_hash" VARCHAR(64) NOT NULL,
        "provider_call_id" VARCHAR(200),
        "status" VARCHAR(16) NOT NULL,
        "requested_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "answered_at" TIMESTAMPTZ,
        "ended_at" TIMESTAMPTZ,
        "duration_seconds" INT,
        "end_reason" VARCHAR(18),
        "failure" VARCHAR(300),
        "hangup_requested_at" TIMESTAMPTZ,
        "recording_ref" VARCHAR(200),
        "recording_ready_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_lead_call" PRIMARY KEY ("id"),
        CONSTRAINT "uq_lead_call_ref" UNIQUE ("ref"),
        CONSTRAINT "fk_lead_call_lead"
          FOREIGN KEY ("lead_id") REFERENCES "lead"."lead" ("id"),
        CONSTRAINT "fk_lead_call_attempt"
          FOREIGN KEY ("attempt_id") REFERENCES "lead"."lead_attempt" ("id"),
        CONSTRAINT "chk_lead_call_direction" CHECK ("direction" IN ('OUT', 'IN')),
        CONSTRAINT "chk_lead_call_channel"
          CHECK ("channel" IN ('OFFICE', 'APP_VOIP', 'APP_BRIDGE')),
        CONSTRAINT "chk_lead_call_status" CHECK ("status" IN
          ('REQUESTED', 'RINGING_OPERATOR', 'RINGING_CUSTOMER', 'CONNECTED', 'ENDED', 'FAILED')),
        CONSTRAINT "chk_lead_call_end_reason" CHECK ("end_reason" IS NULL OR "end_reason" IN
          ('ANSWERED', 'NO_ANSWER', 'BUSY', 'UNREACHABLE', 'OPERATOR_NO_ANSWER', 'CANCELLED', 'FAILED')),
        CONSTRAINT "chk_lead_call_end" CHECK (
          ("status" IN ('ENDED', 'FAILED')) = ("ended_at" IS NOT NULL)
          AND ("ended_at" IS NULL) = ("end_reason" IS NULL)),
        CONSTRAINT "chk_lead_call_duration"
          CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0)
      )
    `);
    // bir operatorda bitta tugamagan qo‘ng‘iroq; tugatish so‘ralgan bo‘lsa yangisini boshlash mumkin
    await q.query(`
      CREATE UNIQUE INDEX "uq_lead_call_operator_active"
      ON "lead"."call" ("operator_id")
      WHERE "ended_at" IS NULL AND "hangup_requested_at" IS NULL
    `);
    await q.query(
      `CREATE INDEX "idx_lead_call_lead" ON "lead"."call" ("lead_id", "id")`,
    );
    await q.query(
      `CREATE INDEX "idx_lead_call_operator" ON "lead"."call" ("operator_id", "requested_at")`,
    );
    await q.query(
      `CREATE INDEX "idx_lead_call_requested" ON "lead"."call" ("requested_at")`,
    );
    await q.query(`
      CREATE TABLE "lead"."call_event" (
        "event_id" VARCHAR(200) NOT NULL,
        "call_id" BIGINT NOT NULL,
        "type" VARCHAR(20) NOT NULL,
        "received_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_lead_call_event" PRIMARY KEY ("event_id"),
        CONSTRAINT "fk_lead_call_event_call"
          FOREIGN KEY ("call_id") REFERENCES "lead"."call" ("id")
      )
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "lead"."call_event"`);
    await q.query(`DROP TABLE "lead"."call"`);
    await q.query(`DROP TABLE "lead"."operator_phone"`);
  }
}
