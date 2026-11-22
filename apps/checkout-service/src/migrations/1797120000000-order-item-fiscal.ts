import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-41 (EQ-09): buyurtma qatoriga fiskal chek nusxasi — katalogdan buyurtma paytida (`catalog.order.snapshot`).
 * Keyin mahsulot kodi yoki optovik STIR i o‘zgarsa ham shu buyurtma chekida nusxadagi qiymat chiqadi.
 * Formatni katalog tekshiradi (MXIK 17 raqam, STIR 9 raqam); bu yerda — faqat nusxa.
 */
export class OrderItemFiscal1797120000000 implements MigrationInterface {
  name = 'OrderItemFiscal1797120000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "checkout"."sales_order_item"
      ADD COLUMN "mxik_code" VARCHAR(17),
      ADD COLUMN "package_code" VARCHAR(20),
      ADD COLUMN "wholesaler_tin" VARCHAR(9)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "checkout"."sales_order_item"
      DROP COLUMN "wholesaler_tin",
      DROP COLUMN "package_code",
      DROP COLUMN "mxik_code"`);
  }
}
