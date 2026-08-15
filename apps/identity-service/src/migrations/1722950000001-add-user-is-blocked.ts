import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * C1.29 — Admin accounts boshqaruvi: users jadvaliga `is_blocked` qo'shiladi.
 * Bloklangan foydalanuvchi tizimga kira olmaydi (login 401). `is_active`dan
 * ATAYLAB alohida: `is_active=false` = tasdiqqacha nofaol (pending seller),
 * `is_blocked=true` = admin bloklagan. Additive.
 */
export class AddUserIsBlocked1722950000001 implements MigrationInterface {
  name = 'AddUserIsBlocked1722950000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "is_blocked" BOOLEAN NOT NULL DEFAULT FALSE`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "identity"."users" DROP COLUMN IF EXISTS "is_blocked"`,
    );
  }
}
