import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCartItemProductName1726416000000 implements MigrationInterface {
  name = 'AddCartItemProductName1726416000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Mahsulot nomi savatga qo'shilgan PAYTDA suratga olinadi — narx bilan bir
    // xil mantiq (`unit_price_snapshot`). Sotuvchi keyin nomni o'zgartirsa ham
    // buyurtmada xaridor ko'rgan nom qoladi.
    await queryRunner.query(
      `ALTER TABLE "checkout"."cart_item"
       ADD COLUMN IF NOT EXISTS "product_name_snapshot" varchar(255)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "checkout"."cart_item"
       DROP COLUMN IF EXISTS "product_name_snapshot"`,
    );
  }
}
