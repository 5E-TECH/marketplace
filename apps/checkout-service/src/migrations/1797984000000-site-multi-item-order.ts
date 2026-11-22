import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-34: saytdan ko‘p tovarli buyurtma — bitta buyurtma, bitta posilka, bir nechta tovar qatori.
 * - `sales_order_item.wholesaler_id` — har tovar o‘z optovigi (qatorlar turli optoviklarniki bo‘lishi mumkin; moliya
 *   `order.status.changed` dagi `items[].wholesalerId` bo‘yicha). Eski qatorlarda bo‘sh — posilka optovigi olinadi.
 * - `sales_order_item.picked_qty` — skaner har tovar qatorini alohida sanaydi (OMB-2). Bitta tovarli posilkalarda
 *   vazifadagi son ko‘chiriladi.
 * - `sales_order.confirmed_via` — OPERATOR yoki SMS (mijoz havola orqali); eski buyurtmalarda bo‘sh.
 */
export class SiteMultiItemOrder1797984000000 implements MigrationInterface {
  name = 'SiteMultiItemOrder1797984000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "checkout"."sales_order_item"
        ADD COLUMN "wholesaler_id" BIGINT,
        ADD COLUMN "picked_qty" INT NOT NULL DEFAULT 0,
        ADD CONSTRAINT "chk_checkout_sales_order_item_picked_qty" CHECK ("picked_qty" >= 0)
    `);
    await q.query(`
      UPDATE "checkout"."sales_order_item" i
         SET "picked_qty" = LEAST(i."quantity", t."picked_qty")
        FROM "checkout"."fulfillment_task" t
       WHERE t."parcel_id" = i."sales_order_seller_id"
         AND t."picked_qty" > 0
         AND (SELECT count(*) FROM "checkout"."sales_order_item" x
               WHERE x."sales_order_seller_id" = i."sales_order_seller_id") = 1
    `);
    await q.query(`
      ALTER TABLE "checkout"."sales_order"
        ADD COLUMN "confirmed_via" VARCHAR(10),
        ADD CONSTRAINT "chk_checkout_sales_order_confirmed_via"
          CHECK ("confirmed_via" IS NULL OR "confirmed_via" IN ('OPERATOR', 'SMS'))
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "checkout"."sales_order"
        DROP CONSTRAINT IF EXISTS "chk_checkout_sales_order_confirmed_via",
        DROP COLUMN IF EXISTS "confirmed_via"
    `);
    await q.query(`
      ALTER TABLE "checkout"."sales_order_item"
        DROP CONSTRAINT IF EXISTS "chk_checkout_sales_order_item_picked_qty",
        DROP COLUMN IF EXISTS "picked_qty",
        DROP COLUMN IF EXISTS "wholesaler_id"
    `);
  }
}
