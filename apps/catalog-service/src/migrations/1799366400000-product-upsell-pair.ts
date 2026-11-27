import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-45 (OPR-4): mahsulotning upsell juftligi — operator tasdiqlash qo‘ng‘irog‘ida taklif qiladigan boshqa mahsulot.
 * Bitta juftlik bitta offer bo‘yicha (admin-offer dizayni) [taklif]. Juftlik mahsuloti o‘chirilsa — juftlik bo‘shaydi.
 */
export class ProductUpsellPair1799366400000 implements MigrationInterface {
  name = 'ProductUpsellPair1799366400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "catalog"."product"
        ADD COLUMN "upsell_product_id" BIGINT
          REFERENCES "catalog"."product" ("id") ON DELETE SET NULL,
        ADD CONSTRAINT "ck_catalog_product_upsell_not_self"
          CHECK ("upsell_product_id" IS NULL OR "upsell_product_id" <> "id")
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "catalog"."product"
        DROP CONSTRAINT "ck_catalog_product_upsell_not_self",
        DROP COLUMN "upsell_product_id"
    `);
  }
}
