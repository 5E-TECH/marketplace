import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-04: `DefaultProductActive1724414400000` mahsulot holati sukutini kichik harf bilan `'active'` qilgan, CHECK
 * (`chk_catalog_product_status`) esa faqat katta harfli qiymatni qabul qiladi (`'ACTIVE'`, `ProductStatus.ACTIVE`).
 * Natija: holat berilmagan mahsulot bazaga yozilmasdi. Eski migratsiya prod’da yurgizilgan — o‘zgartirilmaydi,
 * shu migratsiya sukutni to‘g‘rilaydi (entity bilan bir xil).
 */
export class FixProductStatusDefault1795910400000 implements MigrationInterface {
  name = 'FixProductStatusDefault1795910400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."product" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."product" ALTER COLUMN "status" SET DEFAULT 'active'`,
    );
  }
}
