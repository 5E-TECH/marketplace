import { MigrationInterface, QueryRunner } from 'typeorm';

/** C6.5 — rol o‘zgarganda eski access tokenlarni darhol bekor qilish. */
export class AddUserAuthVersion1725984000000 implements MigrationInterface {
  name = 'AddUserAuthVersion1725984000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "auth_version" INTEGER NOT NULL DEFAULT 1`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "identity"."users" DROP COLUMN IF EXISTS "auth_version"`,
    );
  }
}
