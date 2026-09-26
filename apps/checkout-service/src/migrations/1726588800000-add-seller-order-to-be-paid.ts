import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSellerOrderToBePaid1726588800000 implements MigrationInterface {
  name = 'AddSellerOrderToBePaid1726588800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Elchi posilka yaratganda `to_be_paid` qaytaradi — kuryer qabul
    // qiluvchidan AYNAN shu summani oladi. Bizning `cod_amount` bilan har doim
    // mos kelmaydi (xaridor oqimi Elchi'ga subtotalni yuboradi, `cod_amount`
    // esa yetkazish narxini ham o'z ichiga oladi), shuning uchun yorliqda
    // Elchi aytgan summa ko'rsatiladi — C1.45.
    await queryRunner.query(
      `ALTER TABLE "checkout"."sales_order_seller"
       ADD COLUMN IF NOT EXISTS "elchi_to_be_paid" numeric(14,2)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "checkout"."sales_order_seller"
       DROP COLUMN IF EXISTS "elchi_to_be_paid"`,
    );
  }
}
