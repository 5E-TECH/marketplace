import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Inventory entity'larini loyiha konvensiyasiga (MARKETPLACE_PLAN §5 — barcha
 * entity BaseEntity: id, created_at, updated_at, is_deleted) keltiradi.
 * Dastlabki jadvallarda yetishmayotgan ustunlarni qo'shadi. Additive —
 * mavjud ma'lumotni buzmaydi (DEFAULT bilan to'ldiriladi).
 */
export class AddInventoryBaseColumns1721822400003 implements MigrationInterface {
  name = 'AddInventoryBaseColumns1721822400003';

  async up(queryRunner: QueryRunner): Promise<void> {
    // warehouse: faqat is_deleted yetishmaydi
    await queryRunner.query(
      `ALTER TABLE "inventory"."warehouse" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE`,
    );

    // stock: created_at + is_deleted
    await queryRunner.query(
      `ALTER TABLE "inventory"."stock" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory"."stock" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE`,
    );

    // stock_movement (append-only): updated_at + is_deleted
    await queryRunner.query(
      `ALTER TABLE "inventory"."stock_movement" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory"."stock_movement" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE`,
    );

    // reservation: faqat is_deleted
    await queryRunner.query(
      `ALTER TABLE "inventory"."reservation" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE`,
    );

    // reservation_item: created_at + updated_at + is_deleted
    await queryRunner.query(
      `ALTER TABLE "inventory"."reservation_item" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory"."reservation_item" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory"."reservation_item" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inventory"."reservation_item" DROP COLUMN IF EXISTS "is_deleted"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory"."reservation_item" DROP COLUMN IF EXISTS "updated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory"."reservation_item" DROP COLUMN IF EXISTS "created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory"."reservation" DROP COLUMN IF EXISTS "is_deleted"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory"."stock_movement" DROP COLUMN IF EXISTS "is_deleted"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory"."stock_movement" DROP COLUMN IF EXISTS "updated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory"."stock" DROP COLUMN IF EXISTS "is_deleted"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory"."stock" DROP COLUMN IF EXISTS "created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory"."warehouse" DROP COLUMN IF EXISTS "is_deleted"`,
    );
  }
}
