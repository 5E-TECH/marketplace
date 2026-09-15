import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSellerOrderQrToken1726502400000 implements MigrationInterface {
  name = 'AddSellerOrderQrToken1726502400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Elchi posilka yaratganda `qr_code_token` qaytaradi — pochta posilkani
    // aynan shu token bo'yicha skanerlab qabul qiladi. Yorliqdagi QR ichiga
    // ham shu yoziladi (Elchi frontidagi `printLabelPdf.ts` bilan bir xil).
    // Busiz yorliq chop etib bo'lmaydi — C1.45.
    await queryRunner.query(
      `ALTER TABLE "checkout"."sales_order_seller"
       ADD COLUMN IF NOT EXISTS "qr_code_token" varchar(128)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "checkout"."sales_order_seller"
       DROP COLUMN IF EXISTS "qr_code_token"`,
    );
  }
}
