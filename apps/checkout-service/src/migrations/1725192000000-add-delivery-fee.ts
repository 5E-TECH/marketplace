import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeliveryFee1725192000000 implements MigrationInterface {
  name = 'AddDeliveryFee1725192000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "checkout"."sales_order"
       ADD COLUMN IF NOT EXISTS "delivery_fee" numeric(14,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkout"."sales_order_seller"
       ADD COLUMN IF NOT EXISTS "delivery_fee" numeric(14,2) NOT NULL DEFAULT 0`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "checkout"."sales_order_seller"
       DROP COLUMN IF EXISTS "delivery_fee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkout"."sales_order"
       DROP COLUMN IF EXISTS "delivery_fee"`,
    );
  }
}
