import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-10: lead-service sxemasi (TZ T3/T4; T02:39-40 yangi tahriri — variant va manzil).
 * Sxemani `ensureSchema` yaratadi, migratsiya CREATE SCHEMA qilmaydi.
 * Pul — BIGINT so‘m, vaqt — TIMESTAMPTZ (UTC). Boshqa servislarga havola — FK siz BIGINT (ADR 0001).
 * Manzil kaliti SOATO (EQ-06); yetkazish turi CENTER/ADDRESS (BE-25 shartnomasi).
 */
export class CreateLeadTables1794787200000 implements MigrationInterface {
  name = 'CreateLeadTables1794787200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "lead"."stream" (
        "id" BIGSERIAL NOT NULL,
        "code" VARCHAR(32) NOT NULL,
        "affiliate_id" BIGINT NOT NULL,
        "product_id" BIGINT NOT NULL,
        "sale_price" BIGINT NOT NULL,
        "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
        "template" VARCHAR(10) NOT NULL DEFAULT 'STANDART',
        "sub1" VARCHAR(255),
        "sub2" VARCHAR(255),
        "sub3" VARCHAR(255),
        "sub4" VARCHAR(255),
        "sub5" VARCHAR(255),
        "meta_pixel_id" VARCHAR(64),
        "tiktok_pixel_id" VARCHAR(64),
        "postback_url" TEXT,
        "postback_secret_enc" TEXT,
        "capi_token_enc" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_lead_stream" PRIMARY KEY ("id"),
        CONSTRAINT "uq_lead_stream_code" UNIQUE ("code"),
        CONSTRAINT "chk_lead_stream_sale_price" CHECK ("sale_price" > 0),
        CONSTRAINT "chk_lead_stream_status"
          CHECK ("status" IN ('ACTIVE', 'STOPPED')),
        CONSTRAINT "chk_lead_stream_template"
          CHECK ("template" IN ('STANDART', 'VIDEO'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_stream_affiliate"
      ON "lead"."stream" ("affiliate_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "lead"."click" (
        "id" BIGSERIAL NOT NULL,
        "stream_id" BIGINT NOT NULL,
        "variant" VARCHAR(2),
        "sub1" VARCHAR(255),
        "sub2" VARCHAR(255),
        "sub3" VARCHAR(255),
        "sub4" VARCHAR(255),
        "sub5" VARCHAR(255),
        "utm_source" VARCHAR(255),
        "utm_medium" VARCHAR(255),
        "utm_campaign" VARCHAR(255),
        "utm_content" VARCHAR(255),
        "utm_term" VARCHAR(255),
        "fbclid" VARCHAR(512),
        "fbp" VARCHAR(255),
        "fbc" VARCHAR(255),
        "ip" INET,
        "user_agent" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_lead_click" PRIMARY KEY ("id"),
        CONSTRAINT "fk_lead_click_stream"
          FOREIGN KEY ("stream_id") REFERENCES "lead"."stream" ("id"),
        CONSTRAINT "chk_lead_click_variant"
          CHECK ("variant" IS NULL OR "variant" IN ('s1', 's3'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_click_stream_created"
      ON "lead"."click" ("stream_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "lead"."lead" (
        "id" BIGSERIAL NOT NULL,
        "source" VARCHAR(10) NOT NULL,
        "stream_id" BIGINT,
        "click_id" BIGINT,
        "affiliate_id" BIGINT,
        "product_id" BIGINT NOT NULL,
        "status" VARCHAR(12) NOT NULL DEFAULT 'NEW',
        "name" VARCHAR(100) NOT NULL,
        "phone_e164" VARCHAR(16) NOT NULL,
        "region_soato" VARCHAR(20),
        "district_soato" VARCHAR(20),
        "address_line" VARCHAR(255),
        "where_deliver" VARCHAR(10),
        "address_confirmed_by" BIGINT,
        "address_confirmed_at" TIMESTAMPTZ,
        "variant" VARCHAR(2),
        "quantity" INTEGER NOT NULL DEFAULT 1,
        "sale_price" BIGINT NOT NULL,
        "sub1" VARCHAR(255),
        "sub2" VARCHAR(255),
        "sub3" VARCHAR(255),
        "sub4" VARCHAR(255),
        "sub5" VARCHAR(255),
        "utm_source" VARCHAR(255),
        "utm_medium" VARCHAR(255),
        "utm_campaign" VARCHAR(255),
        "utm_content" VARCHAR(255),
        "utm_term" VARCHAR(255),
        "fbclid" VARCHAR(512),
        "ip" INET,
        "user_agent" TEXT,
        "consent_version" VARCHAR(32),
        "consent_at" TIMESTAMPTZ,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ,
        "expires_at" TIMESTAMPTZ,
        "operator_id" BIGINT,
        "booked_until" TIMESTAMPTZ,
        "merged_into_id" BIGINT,
        "order_id" BIGINT,
        "reject_reason" VARCHAR(20),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_lead_lead" PRIMARY KEY ("id"),
        CONSTRAINT "fk_lead_lead_stream"
          FOREIGN KEY ("stream_id") REFERENCES "lead"."stream" ("id"),
        CONSTRAINT "fk_lead_lead_click"
          FOREIGN KEY ("click_id") REFERENCES "lead"."click" ("id"),
        CONSTRAINT "fk_lead_lead_merged_into"
          FOREIGN KEY ("merged_into_id") REFERENCES "lead"."lead" ("id"),
        CONSTRAINT "chk_lead_lead_source"
          CHECK ("source" IN ('LANDING', 'SITE', 'API')),
        CONSTRAINT "chk_lead_lead_status"
          CHECK ("status" IN ('NEW', 'BOOKED', 'CALLBACK', 'CONFIRMED',
                              'REJECTED', 'INVALID', 'MERGED', 'NO_CONTACT')),
        CONSTRAINT "chk_lead_lead_variant"
          CHECK ("variant" IS NULL OR "variant" IN ('s1', 's3')),
        CONSTRAINT "chk_lead_lead_where_deliver"
          CHECK ("where_deliver" IS NULL
                 OR "where_deliver" IN ('CENTER', 'ADDRESS')),
        CONSTRAINT "chk_lead_lead_reject_reason"
          CHECK ("reject_reason" IS NULL
                 OR "reject_reason" IN ('TOO_EXPENSIVE', 'NOT_NEEDED',
                                        'BOUGHT_ELSEWHERE', 'OTHER')),
        CONSTRAINT "chk_lead_lead_rejected_reason"
          CHECK ("status" <> 'REJECTED' OR "reject_reason" IS NOT NULL),
        CONSTRAINT "chk_lead_lead_quantity" CHECK ("quantity" >= 1),
        CONSTRAINT "chk_lead_lead_sale_price" CHECK ("sale_price" > 0),
        CONSTRAINT "chk_lead_lead_landing_stream"
          CHECK ("source" <> 'LANDING'
                 OR ("stream_id" IS NOT NULL AND "affiliate_id" IS NOT NULL)),
        CONSTRAINT "chk_lead_lead_address_required"
          CHECK ("source" = 'API'
                 OR ("region_soato" IS NOT NULL AND "district_soato" IS NOT NULL
                     AND "address_line" IS NOT NULL
                     AND "where_deliver" IS NOT NULL))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_status_next_attempt"
      ON "lead"."lead" ("status", "next_attempt_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_phone_product"
      ON "lead"."lead" ("phone_e164", "product_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_stream_created"
      ON "lead"."lead" ("stream_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_affiliate_created"
      ON "lead"."lead" ("affiliate_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "lead"."lead_attempt" (
        "id" BIGSERIAL NOT NULL,
        "lead_id" BIGINT NOT NULL,
        "operator_id" BIGINT NOT NULL,
        "call_id" VARCHAR(64),
        "outcome" VARCHAR(12) NOT NULL,
        "comment" TEXT,
        "callback_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_lead_lead_attempt" PRIMARY KEY ("id"),
        CONSTRAINT "fk_lead_lead_attempt_lead"
          FOREIGN KEY ("lead_id") REFERENCES "lead"."lead" ("id"),
        CONSTRAINT "chk_lead_lead_attempt_outcome"
          CHECK ("outcome" IN ('CONFIRMED', 'NO_ANSWER', 'BUSY', 'PHONE_OFF',
                               'CALL_LATER', 'THINKING', 'REJECTED',
                               'INVALID', 'DUPLICATE'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_attempt_lead_created"
      ON "lead"."lead_attempt" ("lead_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "lead"."lead_history" (
        "id" BIGSERIAL NOT NULL,
        "lead_id" BIGINT NOT NULL,
        "from_status" VARCHAR(12),
        "to_status" VARCHAR(12) NOT NULL,
        "actor_id" BIGINT,
        "field" VARCHAR(32),
        "old_value" JSONB,
        "new_value" JSONB,
        "note" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_lead_lead_history" PRIMARY KEY ("id"),
        CONSTRAINT "fk_lead_lead_history_lead"
          FOREIGN KEY ("lead_id") REFERENCES "lead"."lead" ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_lead_history_lead_created"
      ON "lead"."lead_history" ("lead_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "lead"."operator_state" (
        "id" BIGSERIAL NOT NULL,
        "operator_id" BIGINT NOT NULL,
        "state" VARCHAR(10) NOT NULL DEFAULT 'OFFLINE',
        "active_bookings" INTEGER NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_lead_operator_state" PRIMARY KEY ("id"),
        CONSTRAINT "uq_lead_operator_state_operator" UNIQUE ("operator_id"),
        CONSTRAINT "chk_lead_operator_state_state"
          CHECK ("state" IN ('ONLINE', 'BREAK', 'OFFLINE')),
        CONSTRAINT "chk_lead_operator_state_bookings"
          CHECK ("active_bookings" >= 0)
      )
    `);

    for (const table of ['postback_delivery', 'capi_delivery']) {
      await queryRunner.query(`
        CREATE TABLE "lead"."${table}" (
          "id" BIGSERIAL NOT NULL,
          "lead_id" BIGINT NOT NULL,
          "stream_id" BIGINT NOT NULL,
          "event" VARCHAR(32) NOT NULL,
          "attempts" INTEGER NOT NULL DEFAULT 0,
          "next_attempt_at" TIMESTAMPTZ,
          "response_code" INTEGER,
          "delivered_at" TIMESTAMPTZ,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
          CONSTRAINT "pk_lead_${table}" PRIMARY KEY ("id"),
          CONSTRAINT "fk_lead_${table}_lead"
            FOREIGN KEY ("lead_id") REFERENCES "lead"."lead" ("id"),
          CONSTRAINT "fk_lead_${table}_stream"
            FOREIGN KEY ("stream_id") REFERENCES "lead"."stream" ("id"),
          CONSTRAINT "uq_lead_${table}_lead_event" UNIQUE ("lead_id", "event")
        )
      `);
      await queryRunner.query(`
        CREATE INDEX "idx_lead_${table}_pending"
        ON "lead"."${table}" ("next_attempt_at")
        WHERE "delivered_at" IS NULL
      `);
    }

    await queryRunner.query(`
      CREATE TABLE "lead"."affiliate_api_key" (
        "id" BIGSERIAL NOT NULL,
        "affiliate_id" BIGINT NOT NULL,
        "key_hash" VARCHAR(128) NOT NULL,
        "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60,
        "revoked_at" TIMESTAMPTZ,
        "last_used_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_lead_affiliate_api_key" PRIMARY KEY ("id"),
        CONSTRAINT "uq_lead_affiliate_api_key_hash" UNIQUE ("key_hash"),
        CONSTRAINT "chk_lead_affiliate_api_key_limit"
          CHECK ("rate_limit_per_minute" > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_affiliate_api_key_affiliate"
      ON "lead"."affiliate_api_key" ("affiliate_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "lead"."outbox_event" (
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
        CONSTRAINT "pk_lead_outbox_event" PRIMARY KEY ("id"),
        CONSTRAINT "chk_lead_outbox_event_status"
          CHECK ("status" IN ('PENDING', 'PROCESSED', 'FAILED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_lead_outbox_event_status_created"
      ON "lead"."outbox_event" ("status", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'outbox_event',
      'affiliate_api_key',
      'capi_delivery',
      'postback_delivery',
      'operator_state',
      'lead_history',
      'lead_attempt',
      'lead',
      'click',
      'stream',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "lead"."${table}"`);
    }
  }
}
