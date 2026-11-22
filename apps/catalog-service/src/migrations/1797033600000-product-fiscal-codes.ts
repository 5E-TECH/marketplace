import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-41 (EQ-09): fiskal chek qatori uchun mahsulot kodlari — admin tasdiqlashda kiritadi.
 * - `mxik_code`: MXIK (IKPU), 17 raqam — chekning har qatorida majburiy (tasnif.soliq.uz);
 * - `package_code`: qadoq (o‘lchov birligi) kodi, faqat raqam [taklif: 1–20 belgi, formati buxgalter bilan aniqlanadi].
 */
export class ProductFiscalCodes1797033600000 implements MigrationInterface {
  name = 'ProductFiscalCodes1797033600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "catalog"."product"
      ADD COLUMN "mxik_code" VARCHAR(17),
      ADD COLUMN "package_code" VARCHAR(20),
      ADD CONSTRAINT "chk_catalog_product_mxik_code" CHECK ("mxik_code" IS NULL OR "mxik_code" ~ '^[0-9]{17}$'),
      ADD CONSTRAINT "chk_catalog_product_package_code" CHECK ("package_code" IS NULL OR "package_code" ~ '^[0-9]{1,20}$')`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "catalog"."product"
      DROP CONSTRAINT "chk_catalog_product_package_code",
      DROP CONSTRAINT "chk_catalog_product_mxik_code",
      DROP COLUMN "package_code",
      DROP COLUMN "mxik_code"`);
  }
}
