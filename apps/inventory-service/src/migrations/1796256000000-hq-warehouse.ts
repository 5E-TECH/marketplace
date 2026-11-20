import { MigrationInterface, QueryRunner } from 'typeorm';

const TYPES_OLD = [
  'INBOUND',
  'OUTBOUND',
  'RESERVE',
  'RELEASE',
  'COMMIT',
  'ADJUST',
  'TRANSFER',
];
const TYPES = [
  ...TYPES_OLD,
  'RETURN',
  'DEFECT',
  'WRITE_OFF',
  'RETURN_TO_SUPPLIER',
];
const list = (values: string[]) => values.map((v) => `'${v}'`).join(', ');

/**
 * BE-16 (TZ 6.6): bitta HQ ombor (platforma ombori, `owner_id` = 0); qoldiq egasi — mahsulot optovigi (catalog).
 * Harakat turlariga qaytish, brak, hisobdan chiqarish va optovikka qaytarish qo‘shiladi.
 */
export class HqWarehouse1796256000000 implements MigrationInterface {
  name = 'HqWarehouse1796256000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "inventory"."stock_movement" DROP CONSTRAINT IF EXISTS "chk_inventory_stock_movement_type"`,
    );
    await q.query(
      `ALTER TABLE "inventory"."stock_movement" ADD CONSTRAINT "chk_inventory_stock_movement_type" CHECK ("type" IN (${list(TYPES)}))`,
    );
    await q.query(`INSERT INTO "inventory"."warehouse" ("owner_type", "owner_id", "name", "is_default", "is_active")
      SELECT 'HQ', 0, 'HQ ombor', TRUE, TRUE
      WHERE NOT EXISTS (SELECT 1 FROM "inventory"."warehouse" WHERE "owner_type" = 'HQ' AND "is_deleted" = FALSE)`);
    await q.query(`CREATE UNIQUE INDEX "uq_inventory_warehouse_single_hq" ON "inventory"."warehouse" ("owner_type")
      WHERE "owner_type" = 'HQ' AND "is_deleted" = FALSE`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP INDEX IF EXISTS "inventory"."uq_inventory_warehouse_single_hq"`,
    );
    await q.query(
      `ALTER TABLE "inventory"."stock_movement" DROP CONSTRAINT IF EXISTS "chk_inventory_stock_movement_type"`,
    );
    // Yangi turdagi harakat bo‘lsa, eski CHECK qo‘yilmaydi — xato bilan to‘xtaydi (tarix buzilmaydi)
    await q.query(
      `ALTER TABLE "inventory"."stock_movement" ADD CONSTRAINT "chk_inventory_stock_movement_type" CHECK ("type" IN (${list(TYPES_OLD)}))`,
    );
  }
}
