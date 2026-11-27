import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-45 (OPR-4): buyurtmadagi qo‘shimcha tovar qatori (operator qo‘ng‘iroqda qo‘shgan upsell) belgisi.
 * Narx — tasdiqlangan narx, sotuvchi haqi platformada [taklif, EQ-14] (`affiliate_fee` 0, `platform_service` ga qo‘shilgan).
 */
export class OrderItemUpsell1799366400000 implements MigrationInterface {
  name = 'OrderItemUpsell1799366400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "checkout"."sales_order_item"
        ADD COLUMN "is_upsell" BOOLEAN NOT NULL DEFAULT false
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "checkout"."sales_order_item" DROP COLUMN "is_upsell"
    `);
  }
}
