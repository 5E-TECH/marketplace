import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-09: narx kalkulyatori (TZ 2-bo‘lim, 6.13).
 * - `price_policy` — parametrlar: global → kategoriya → mahsulot (bo‘sh maydon — yuqori darajadan); global sukut TZ dan;
 *   K kasrli (2 xona): «Narx» varag‘idagi K butun emas, TZ matnida yaxlitlangan (29 688, 15 232);
 * - `elchi_tariff` — Elchi tarifi kuchga kirish vaqti bilan (NRX-7), tarix o‘chmaydi;
 * - `price_decision` — har narx qarori: kim, qachon, holat, sabab, hisob nusxasi (NRX-6);
 * - mahsulotda tasdiqlangan narx, uning holati va bozor narxi (raqobatchida mijoz jami, NRX-4/NRX-5).
 */
export class Pricing1796169600000 implements MigrationInterface {
  name = 'Pricing1796169600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "catalog"."price_policy" (
      "id" BIGSERIAL PRIMARY KEY,
      "scope" VARCHAR(10) NOT NULL,
      "scope_id" BIGINT,
      "k_sale70" NUMERIC(12,2),
      "k_sale100" NUMERIC(12,2),
      "target_margin" BIGINT,
      "tax_rate" NUMERIC(6,4),
      "payment_rate" NUMERIC(6,4),
      "call_center_fee" BIGINT,
      "affiliate_coef" NUMERIC(6,3),
      "ad_cost" BIGINT,
      "markup_cap_percent" NUMERIC(5,2),
      "delivery_mode" VARCHAR(10),
      "visible_center" BIGINT,
      "visible_address" BIGINT,
      "updated_by" BIGINT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
      CONSTRAINT "chk_catalog_price_policy_scope" CHECK (
        ("scope" = 'GLOBAL' AND "scope_id" IS NULL) OR ("scope" IN ('CATEGORY', 'PRODUCT') AND "scope_id" IS NOT NULL)),
      CONSTRAINT "chk_catalog_price_policy_mode" CHECK ("delivery_mode" IS NULL OR "delivery_mode" IN ('SEPARATE', 'PARTIAL', 'FREE')),
      CONSTRAINT "chk_catalog_price_policy_money" CHECK (
        COALESCE("k_sale70", 0) >= 0 AND COALESCE("k_sale100", 0) >= 0 AND COALESCE("target_margin", 0) >= 0
        AND COALESCE("call_center_fee", 0) >= 0 AND COALESCE("ad_cost", 0) >= 0
        AND COALESCE("visible_center", 0) >= 0 AND COALESCE("visible_address", 0) >= 0),
      CONSTRAINT "chk_catalog_price_policy_rates" CHECK (
        COALESCE("tax_rate", 0) BETWEEN 0 AND 0.5 AND COALESCE("payment_rate", 0) BETWEEN 0 AND 0.5
        AND COALESCE("affiliate_coef", 0) >= 0 AND COALESCE("markup_cap_percent", 0) BETWEEN 0 AND 100))`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_catalog_price_policy_scope" ON "catalog"."price_policy" ("scope", COALESCE("scope_id", 0)) WHERE "is_deleted" = FALSE`,
    );
    // Global sukut — TZ 2.1, 2.2, 2.4, 2.5 (ega 2026-10-23 da tasdiqlagan «Narx» varag‘i)
    await q.query(`INSERT INTO "catalog"."price_policy"
      ("scope", "k_sale70", "k_sale100", "target_margin", "tax_rate", "payment_rate", "call_center_fee",
       "affiliate_coef", "ad_cost", "markup_cap_percent", "delivery_mode", "visible_center", "visible_address")
      VALUES ('GLOBAL', 29688, 15232, 9000, 0.04, 0.0185, 12000, 1.29, 50420, 10, 'PARTIAL', 30000, 50000)`);

    await q.query(`CREATE TABLE "catalog"."elchi_tariff" (
      "id" BIGSERIAL PRIMARY KEY,
      "center_base" BIGINT NOT NULL,
      "base_weight_grams" INTEGER NOT NULL,
      "per_extra_kg" BIGINT NOT NULL,
      "address_extra" BIGINT NOT NULL,
      "effective_from" TIMESTAMPTZ NOT NULL,
      "created_by" BIGINT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
      CONSTRAINT "chk_catalog_elchi_tariff_values" CHECK (
        "center_base" >= 0 AND "base_weight_grams" > 0 AND "per_extra_kg" >= 0 AND "address_extra" >= 0))`);
    await q.query(
      `CREATE INDEX "idx_catalog_elchi_tariff_effective" ON "catalog"."elchi_tariff" ("effective_from" DESC)`,
    );
    // Elchi tariflari, 14.08.2026 (TZ 2.4)
    await q.query(`INSERT INTO "catalog"."elchi_tariff"
      ("center_base", "base_weight_grams", "per_extra_kg", "address_extra", "effective_from")
      VALUES (40000, 3000, 4000, 20000, '2026-08-14T00:00:00+05:00')`);

    await q.query(`CREATE TABLE "catalog"."price_decision" (
      "id" BIGSERIAL PRIMARY KEY,
      "product_id" BIGINT NOT NULL REFERENCES "catalog"."product" ("id") ON DELETE RESTRICT,
      "price" BIGINT NOT NULL,
      "base_price" BIGINT NOT NULL,
      "affiliate_fee" BIGINT NOT NULL,
      "recommended" BIGINT NOT NULL,
      "status" VARCHAR(10) NOT NULL,
      "reason" TEXT,
      "calculation" JSONB NOT NULL,
      "decided_by" BIGINT NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
      CONSTRAINT "chk_catalog_price_decision_status" CHECK ("status" IN ('GREEN', 'YELLOW', 'ORANGE')),
      CONSTRAINT "chk_catalog_price_decision_orange_reason" CHECK ("status" <> 'ORANGE' OR length(trim("reason")) > 0),
      CONSTRAINT "chk_catalog_price_decision_money" CHECK ("price" > 0 AND "base_price" >= 0 AND "affiliate_fee" >= 0))`);
    await q.query(
      `CREATE INDEX "idx_catalog_price_decision_product" ON "catalog"."price_decision" ("product_id", "created_at" DESC)`,
    );

    await q.query(`ALTER TABLE "catalog"."product"
      ADD COLUMN "approved_price" BIGINT,
      ADD COLUMN "price_status" VARCHAR(10),
      ADD COLUMN "market_total" BIGINT,
      ADD CONSTRAINT "chk_catalog_product_approved_price" CHECK ("approved_price" IS NULL OR "approved_price" > 0),
      ADD CONSTRAINT "chk_catalog_product_price_status" CHECK ("price_status" IS NULL OR "price_status" IN ('GREEN', 'YELLOW', 'ORANGE')),
      ADD CONSTRAINT "chk_catalog_product_market_total" CHECK ("market_total" IS NULL OR "market_total" > 0)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "catalog"."product"
      DROP CONSTRAINT IF EXISTS "chk_catalog_product_approved_price",
      DROP CONSTRAINT IF EXISTS "chk_catalog_product_price_status",
      DROP CONSTRAINT IF EXISTS "chk_catalog_product_market_total",
      DROP COLUMN IF EXISTS "approved_price",
      DROP COLUMN IF EXISTS "price_status",
      DROP COLUMN IF EXISTS "market_total"`);
    await q.query(`DROP TABLE IF EXISTS "catalog"."price_decision"`);
    await q.query(`DROP TABLE IF EXISTS "catalog"."elchi_tariff"`);
    await q.query(`DROP TABLE IF EXISTS "catalog"."price_policy"`);
  }
}
