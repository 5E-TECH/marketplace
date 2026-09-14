import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSalesOrderSessionId1726329600000 implements MigrationInterface {
  name = 'AddSalesOrderSessionId1726329600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "checkout"."sales_order"
       ADD COLUMN IF NOT EXISTS "session_id" varchar(255)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "checkout"."sales_order"
       DROP COLUMN IF EXISTS "session_id"`,
    );
  }
}
