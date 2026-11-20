import { MigrationInterface, QueryRunner } from 'typeorm';

const STATUSES = [
  'CONFIRMED',
  'PICKING',
  'PACKED',
  'HANDED_TO_ELCHI',
  'IN_TRANSIT',
  'DELIVERED',
  'REMITTED',
  'RETURN_REQUESTED',
  'SETTLED',
  'REFUSED',
  'RETURNING',
  'RETURNED_GRADED',
  'CANCELLED',
]
  .map((s) => `'${s}'`)
  .join(', ');

/**
 * BE-18 (TZ T4, T5, NRX-10): liddan buyurtma.
 * - `sales_order` — manba, lid, oqim, sotuvchi, optovik, telefon (manzildan alohida), SOATO, yetkazish rejimi, mijozga
 *   ko‘rinadigan yetkazish, Elchi tarifi, yashirilgan qism, og‘irlik, COD. Lid buyurtmasining holati CHECK bilan T5
 *   holatlariga cheklangan; eski buyurtmalar (manbasiz) o‘zgarmaydi. Mijoz foydalanuvchi emas — `customer_id` bo‘sh.
 * - `sales_order_item` — narx nusxasi (bir dona): bazaviy, tavsiya, tasdiqlangan narx, ustama, sotuvchi haqi,
 *   qo‘ng‘iroq markazi, yashirilgan yetkazish, platforma xizmati; SKU va og‘irlik.
 * - `order_status_history` — holat jurnali, rad etilgan o‘tishlar ham (BUY-2).
 * - `lead_order_request` — `lead.confirmed` so‘rovlari: qayta urinish va takrorsizlik (TC6).
 */
export class LeadOrder1796342400000 implements MigrationInterface {
  name = 'LeadOrder1796342400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "checkout"."sales_order"
        ALTER COLUMN "customer_id" DROP NOT NULL,
        ADD COLUMN "source" VARCHAR(10),
        ADD COLUMN "lead_id" BIGINT,
        ADD COLUMN "stream_id" BIGINT,
        ADD COLUMN "affiliate_id" BIGINT,
        ADD COLUMN "wholesaler_id" BIGINT,
        ADD COLUMN "customer_phone" VARCHAR(20),
        ADD COLUMN "region_soato" VARCHAR(20),
        ADD COLUMN "district_soato" VARCHAR(20),
        ADD COLUMN "delivery_mode" VARCHAR(10),
        ADD COLUMN "delivery_shown" BIGINT,
        ADD COLUMN "delivery_cost" BIGINT,
        ADD COLUMN "delivery_embedded" BIGINT,
        ADD COLUMN "weight_grams" INTEGER,
        ADD COLUMN "cod_amount" BIGINT,
        ADD COLUMN "confirmed_by" BIGINT,
        ADD COLUMN "address_confirmed_by" BIGINT,
        ADD CONSTRAINT "chk_checkout_sales_order_customer"
          CHECK ("customer_id" IS NOT NULL OR "source" IS NOT NULL),
        ADD CONSTRAINT "chk_checkout_sales_order_lead" CHECK (
          "source" IS NULL OR (
            "source" IN ('LANDING', 'SITE', 'API')
            AND "lead_id" IS NOT NULL
            AND "wholesaler_id" IS NOT NULL
            AND "customer_phone" ~ '^\\+998[0-9]{9}$'
            AND "region_soato" IS NOT NULL
            AND "district_soato" IS NOT NULL
            AND "delivery_mode" IN ('SEPARATE', 'PARTIAL', 'FREE')
            AND "delivery_shown" >= 0
            AND "delivery_cost" >= 0
            AND "delivery_embedded" >= 0
            AND "weight_grams" > 0
            AND "cod_amount" >= 0
            AND "status" IN (${STATUSES})
          )
        )
    `);
    await q.query(`
      CREATE UNIQUE INDEX "uq_checkout_sales_order_lead"
      ON "checkout"."sales_order" ("lead_id") WHERE "lead_id" IS NOT NULL
    `);
    await q.query(`
      CREATE INDEX "idx_checkout_sales_order_source_created"
      ON "checkout"."sales_order" ("source", "created_at" DESC)
      WHERE "source" IS NOT NULL
    `);

    await q.query(`
      ALTER TABLE "checkout"."sales_order_item"
        ADD COLUMN "sku" VARCHAR(100),
        ADD COLUMN "weight_grams" INTEGER,
        ADD COLUMN "base_price" BIGINT,
        ADD COLUMN "recommended_price" BIGINT,
        ADD COLUMN "approved_price" BIGINT,
        ADD COLUMN "markup" BIGINT,
        ADD COLUMN "affiliate_fee" BIGINT,
        ADD COLUMN "call_center_fee" BIGINT,
        ADD COLUMN "hidden_delivery" BIGINT,
        ADD COLUMN "platform_service" BIGINT,
        ADD CONSTRAINT "chk_checkout_sales_order_item_snapshot" CHECK (
          "approved_price" IS NULL OR (
            "base_price" >= 0
            AND "recommended_price" >= 0
            AND "approved_price" >= 0
            AND "markup" >= 0
            AND "unit_price" = "approved_price" + "markup"
            AND "affiliate_fee" >= 0
            AND "call_center_fee" >= 0
            AND "hidden_delivery" >= 0
            AND "platform_service" IS NOT NULL
            AND "weight_grams" > 0
            AND "quantity" > 0
          )
        )
    `);

    await q.query(`
      CREATE TABLE "checkout"."order_status_history" (
        "id" BIGSERIAL PRIMARY KEY,
        "order_id" BIGINT NOT NULL REFERENCES "checkout"."sales_order"("id"),
        "from_status" VARCHAR(20),
        "to_status" VARCHAR(20) NOT NULL,
        "accepted" BOOLEAN NOT NULL,
        "actor_type" VARCHAR(10) NOT NULL,
        "actor_id" BIGINT,
        "actor_role" VARCHAR(20),
        "reason" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_checkout_order_status_history_to"
          CHECK ("to_status" IN (${STATUSES})),
        CONSTRAINT "chk_checkout_order_status_history_from"
          CHECK ("from_status" IS NULL OR "from_status" IN (${STATUSES})),
        CONSTRAINT "chk_checkout_order_status_history_actor"
          CHECK ("actor_type" IN ('SYSTEM', 'USER', 'ELCHI'))
      )
    `);
    await q.query(`
      CREATE INDEX "idx_checkout_order_status_history_order"
      ON "checkout"."order_status_history" ("order_id", "id")
    `);

    await q.query(`
      CREATE TABLE "checkout"."lead_order_request" (
        "id" BIGSERIAL PRIMARY KEY,
        "event_id" VARCHAR(200) NOT NULL,
        "lead_id" BIGINT NOT NULL,
        "order_id" BIGINT NOT NULL,
        "payload" JSONB NOT NULL,
        "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
        "failure_reason" VARCHAR(30),
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "last_error" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_checkout_lead_order_request_event" UNIQUE ("event_id"),
        CONSTRAINT "uq_checkout_lead_order_request_order" UNIQUE ("order_id"),
        CONSTRAINT "chk_checkout_lead_order_request_status"
          CHECK ("status" IN ('PENDING', 'DONE', 'FAILED'))
      )
    `);
    // Bitta lidga bitta faol so‘rov: bajarilgan yoki kutilayotgan. Rad etilgandan keyin (qoldiq yo‘q) lid qayta
    // tasdiqlansa — yangi so‘rov.
    await q.query(`
      CREATE UNIQUE INDEX "uq_checkout_lead_order_request_lead"
      ON "checkout"."lead_order_request" ("lead_id") WHERE "status" <> 'FAILED'
    `);
    await q.query(`
      CREATE INDEX "idx_checkout_lead_order_request_due"
      ON "checkout"."lead_order_request" ("next_attempt_at", "id")
      WHERE "status" = 'PENDING'
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "checkout"."lead_order_request"`);
    await q.query(`DROP TABLE "checkout"."order_status_history"`);
    // Lid buyurtmalarida mijoz yo‘q — eski sxemaga (customer_id NOT NULL) ular sig‘maydi.
    await q.query(`
      DELETE FROM "checkout"."sales_order_item" i
       USING "checkout"."sales_order_seller" s, "checkout"."sales_order" o
       WHERE i."sales_order_seller_id" = s."id" AND s."sales_order_id" = o."id"
         AND o."source" IS NOT NULL
    `);
    await q.query(`
      DELETE FROM "checkout"."sales_order_seller_history" h
       USING "checkout"."sales_order_seller" s, "checkout"."sales_order" o
       WHERE h."sales_order_seller_id" = s."id" AND s."sales_order_id" = o."id"
         AND o."source" IS NOT NULL
    `);
    await q.query(`
      DELETE FROM "checkout"."sales_order_seller" s
       USING "checkout"."sales_order" o
       WHERE s."sales_order_id" = o."id" AND o."source" IS NOT NULL
    `);
    await q.query(
      `DELETE FROM "checkout"."sales_order" WHERE "source" IS NOT NULL`,
    );
    await q.query(`
      ALTER TABLE "checkout"."sales_order_item"
        DROP CONSTRAINT "chk_checkout_sales_order_item_snapshot",
        DROP COLUMN "sku", DROP COLUMN "weight_grams", DROP COLUMN "base_price",
        DROP COLUMN "recommended_price", DROP COLUMN "approved_price", DROP COLUMN "markup",
        DROP COLUMN "affiliate_fee", DROP COLUMN "call_center_fee", DROP COLUMN "hidden_delivery",
        DROP COLUMN "platform_service"
    `);
    await q.query(
      `DROP INDEX "checkout"."idx_checkout_sales_order_source_created"`,
    );
    await q.query(`DROP INDEX "checkout"."uq_checkout_sales_order_lead"`);
    await q.query(`
      ALTER TABLE "checkout"."sales_order"
        DROP CONSTRAINT "chk_checkout_sales_order_lead",
        DROP CONSTRAINT "chk_checkout_sales_order_customer",
        DROP COLUMN "source", DROP COLUMN "lead_id", DROP COLUMN "stream_id",
        DROP COLUMN "affiliate_id", DROP COLUMN "wholesaler_id", DROP COLUMN "customer_phone",
        DROP COLUMN "region_soato", DROP COLUMN "district_soato", DROP COLUMN "delivery_mode",
        DROP COLUMN "delivery_shown", DROP COLUMN "delivery_cost", DROP COLUMN "delivery_embedded",
        DROP COLUMN "weight_grams", DROP COLUMN "cod_amount", DROP COLUMN "confirmed_by",
        DROP COLUMN "address_confirmed_by",
        ALTER COLUMN "customer_id" SET NOT NULL
    `);
  }
}
