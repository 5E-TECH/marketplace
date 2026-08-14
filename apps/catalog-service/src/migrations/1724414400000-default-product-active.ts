import { MigrationInterface, QueryRunner } from 'typeorm';

export class DefaultProductActive1724414400000 implements MigrationInterface {
  name = 'DefaultProductActive1724414400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."product" ALTER COLUMN "status" SET DEFAULT 'active'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog"."product" ALTER COLUMN "status" SET DEFAULT 'draft'`,
    );
  }
}
