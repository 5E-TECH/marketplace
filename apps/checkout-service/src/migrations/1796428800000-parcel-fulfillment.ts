import { MigrationInterface, QueryRunner } from 'typeorm';
import { processedEventTableSql } from '@app/common';

/**
 * BE-19 (TZ T4, OMB-2, OMB-4, OMB-5):
 * - `sales_order_seller` → `parcel` (ID lar saqlanadi). Eski kod uchun eski nom bilan ko‘rinish (view) qoladi —
 *   o‘qish, yozish va qulflash u orqali asosiy jadvalga o‘tadi; BE-29 da eski kod bilan birga o‘chiriladi.
 * - `parcel` ga Elchi holati, xato, topshirish vaqti va akt.
 * - `fulfillment_task` — yig‘ish vazifasi (TO_PICK, PICKED, PACKED, HANDED_OVER; bekor — CANCELLED) va yig‘ish kuni.
 * - `fulfillment_scan` — skaner jurnali (noto‘g‘ri tovar ham).
 * - `handover_act`, `handover_act_item` — Elchi’ga topshirish akti.
 * - `sales_order_item.barcode` — skaner uchun shtrix-kod (narx nusxasi bilan katalogdan).
 * - `processed_event` — Elchi posilka xabarlari bir marta ishlanadi.
 */
export class ParcelFulfillment1796428800000 implements MigrationInterface {
  name = 'ParcelFulfillment1796428800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "checkout"."sales_order_seller" RENAME TO "parcel"`,
    );
    await q.query(
      `ALTER SEQUENCE "checkout"."sales_order_seller_id_seq" RENAME TO "parcel_id_seq"`,
    );
    await q.query(`
      ALTER TABLE "checkout"."parcel"
        ADD COLUMN "elchi_state" VARCHAR(15),
        ADD COLUMN "elchi_error" TEXT,
        ADD COLUMN "handed_over_at" TIMESTAMPTZ,
        ADD COLUMN "handover_act_id" BIGINT,
        ADD CONSTRAINT "chk_checkout_parcel_elchi_state" CHECK (
          "elchi_state" IS NULL OR
          "elchi_state" IN ('PENDING', 'CREATED', 'FAILED', 'CANCELLED', 'CANCEL_FAILED')
        )
    `);
    // Lid buyurtmalarining posilkasi: Elchi raqami bo‘lsa — yaratilgan, bo‘lmasa — kutilmoqda
    await q.query(`
      UPDATE "checkout"."parcel" p
         SET "elchi_state" = CASE WHEN p."elchi_shipment_id" IS NOT NULL THEN 'CREATED' ELSE 'PENDING' END
        FROM "checkout"."sales_order" o
       WHERE o."id" = p."sales_order_id" AND o."source" IS NOT NULL
    `);
    // Eski nom — eski kod uchun (oddiy ko‘rinish Postgres’da avtomatik yangilanadigan: INSERT/UPDATE/DELETE va
    // FOR UPDATE asosiy jadvalga o‘tadi). Ustunlar shu paytdagi `parcel` ustunlari.
    await q.query(
      `CREATE VIEW "checkout"."sales_order_seller" AS SELECT * FROM "checkout"."parcel"`,
    );

    await q.query(`
      CREATE TABLE "checkout"."handover_act" (
        "id" BIGSERIAL PRIMARY KEY,
        "parcel_count" INTEGER NOT NULL CHECK ("parcel_count" > 0),
        "created_by" BIGINT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      CREATE TABLE "checkout"."handover_act_item" (
        "id" BIGSERIAL PRIMARY KEY,
        "act_id" BIGINT NOT NULL REFERENCES "checkout"."handover_act"("id"),
        "parcel_id" BIGINT NOT NULL REFERENCES "checkout"."parcel"("id"),
        "order_id" BIGINT NOT NULL REFERENCES "checkout"."sales_order"("id"),
        "shipment_id" BIGINT NOT NULL,
        "qr_code_token" VARCHAR(128) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_checkout_handover_act_item_parcel" UNIQUE ("parcel_id")
      )
    `);
    await q.query(`
      CREATE INDEX "idx_checkout_handover_act_item_act"
      ON "checkout"."handover_act_item" ("act_id", "id")
    `);
    await q.query(`
      ALTER TABLE "checkout"."parcel"
        ADD CONSTRAINT "fk_checkout_parcel_handover_act"
        FOREIGN KEY ("handover_act_id") REFERENCES "checkout"."handover_act"("id")
    `);

    await q.query(`
      CREATE TABLE "checkout"."fulfillment_task" (
        "id" BIGSERIAL PRIMARY KEY,
        "order_id" BIGINT NOT NULL REFERENCES "checkout"."sales_order"("id"),
        "parcel_id" BIGINT NOT NULL REFERENCES "checkout"."parcel"("id"),
        "status" VARCHAR(12) NOT NULL DEFAULT 'TO_PICK',
        "pick_date" DATE NOT NULL,
        "required_qty" INTEGER NOT NULL,
        "picked_qty" INTEGER NOT NULL DEFAULT 0,
        "picked_at" TIMESTAMPTZ,
        "picked_by" BIGINT,
        "packed_at" TIMESTAMPTZ,
        "packed_by" BIGINT,
        "handed_over_at" TIMESTAMPTZ,
        "handed_over_by" BIGINT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_checkout_fulfillment_task_order" UNIQUE ("order_id"),
        CONSTRAINT "uq_checkout_fulfillment_task_parcel" UNIQUE ("parcel_id"),
        CONSTRAINT "chk_checkout_fulfillment_task_status"
          CHECK ("status" IN ('TO_PICK', 'PICKED', 'PACKED', 'HANDED_OVER', 'CANCELLED')),
        CONSTRAINT "chk_checkout_fulfillment_task_qty"
          CHECK ("required_qty" > 0 AND "picked_qty" BETWEEN 0 AND "required_qty"),
        CONSTRAINT "chk_checkout_fulfillment_task_picked"
          CHECK ("status" NOT IN ('PICKED', 'PACKED', 'HANDED_OVER') OR "picked_qty" = "required_qty")
      )
    `);
    await q.query(`
      CREATE INDEX "idx_checkout_fulfillment_task_pick"
      ON "checkout"."fulfillment_task" ("pick_date", "status")
    `);
    await q.query(`
      CREATE TABLE "checkout"."fulfillment_scan" (
        "id" BIGSERIAL PRIMARY KEY,
        "task_id" BIGINT NOT NULL REFERENCES "checkout"."fulfillment_task"("id"),
        "code" VARCHAR(100) NOT NULL,
        "matched" BOOLEAN NOT NULL,
        "actor_id" BIGINT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      CREATE INDEX "idx_checkout_fulfillment_scan_task"
      ON "checkout"."fulfillment_scan" ("task_id", "id")
    `);
    await q.query(
      `ALTER TABLE "checkout"."sales_order_item" ADD COLUMN "barcode" VARCHAR(100)`,
    );
    await q.query(processedEventTableSql('checkout'));

    // Mavjud lid buyurtmalariga vazifa (yig‘ish kuni — yaratilgan vaqtdan, 14:00 chegarasi bilan)
    await q.query(`
      INSERT INTO "checkout"."fulfillment_task"
        ("order_id", "parcel_id", "status", "pick_date", "required_qty", "picked_qty")
      SELECT o."id", p."id",
             CASE o."status"
               WHEN 'CONFIRMED' THEN 'TO_PICK'
               WHEN 'PICKING' THEN 'TO_PICK'
               WHEN 'PACKED' THEN 'PACKED'
               WHEN 'CANCELLED' THEN 'CANCELLED'
               ELSE 'HANDED_OVER'
             END,
             CASE WHEN EXTRACT(HOUR FROM (o."created_at" AT TIME ZONE 'Asia/Tashkent')) < 14
                  THEN (o."created_at" AT TIME ZONE 'Asia/Tashkent')::date
                  ELSE (o."created_at" AT TIME ZONE 'Asia/Tashkent')::date + 1 END,
             q."qty",
             CASE WHEN o."status" IN ('CONFIRMED', 'PICKING', 'CANCELLED') THEN 0 ELSE q."qty" END
        FROM "checkout"."sales_order" o
        JOIN "checkout"."parcel" p ON p."sales_order_id" = o."id"
        JOIN LATERAL (
          SELECT SUM(i."quantity")::int AS "qty"
            FROM "checkout"."sales_order_item" i
           WHERE i."sales_order_seller_id" = p."id"
        ) q ON q."qty" > 0
       WHERE o."source" IS NOT NULL
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    // Topshirish akti — Elchi’ga jismonan berilgan posilkalar yozuvi: bor bo‘lsa qaytarilmaydi
    const [{ count }] = (await q.query(
      `SELECT COUNT(*)::int AS count FROM "checkout"."handover_act"`,
    )) as Array<{ count: number }>;
    if (count > 0)
      throw new Error(
        `ParcelFulfillment1796428800000: ${count} ta topshirish akti bor — migratsiya qaytarilmaydi`,
      );
    await q.query(`DROP TABLE "checkout"."processed_event"`);
    await q.query(
      `ALTER TABLE "checkout"."sales_order_item" DROP COLUMN "barcode"`,
    );
    await q.query(`DROP TABLE "checkout"."fulfillment_scan"`);
    await q.query(`DROP TABLE "checkout"."fulfillment_task"`);
    await q.query(
      `ALTER TABLE "checkout"."parcel" DROP CONSTRAINT "fk_checkout_parcel_handover_act"`,
    );
    await q.query(`DROP TABLE "checkout"."handover_act_item"`);
    await q.query(`DROP TABLE "checkout"."handover_act"`);
    await q.query(`DROP VIEW "checkout"."sales_order_seller"`);
    await q.query(`
      ALTER TABLE "checkout"."parcel"
        DROP CONSTRAINT "chk_checkout_parcel_elchi_state",
        DROP COLUMN "elchi_state", DROP COLUMN "elchi_error",
        DROP COLUMN "handed_over_at", DROP COLUMN "handover_act_id"
    `);
    await q.query(
      `ALTER SEQUENCE "checkout"."parcel_id_seq" RENAME TO "sales_order_seller_id_seq"`,
    );
    await q.query(
      `ALTER TABLE "checkout"."parcel" RENAME TO "sales_order_seller"`,
    );
  }
}
