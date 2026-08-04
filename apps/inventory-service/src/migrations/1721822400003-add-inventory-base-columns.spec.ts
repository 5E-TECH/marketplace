import { QueryRunner } from 'typeorm';
import { AddInventoryBaseColumns1721822400003 } from './1721822400003-add-inventory-base-columns';

describe('AddInventoryBaseColumns1721822400003', () => {
  it('yetishmayotgan BaseEntity ustunlarini qo‘shadi', async () => {
    const query = jest.fn(async (_sql: string) => undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new AddInventoryBaseColumns1721822400003().up(queryRunner);

    const all = query.mock.calls
      .map((c) => String(c[0]).replace(/\s+/g, ' ').trim())
      .join('\n');
    // har jadval uchun is_deleted
    expect(all).toContain(
      'ALTER TABLE "inventory"."warehouse" ADD COLUMN IF NOT EXISTS "is_deleted"',
    );
    expect(all).toContain(
      'ALTER TABLE "inventory"."reservation" ADD COLUMN IF NOT EXISTS "is_deleted"',
    );
    // stock — created_at ham
    expect(all).toContain(
      'ALTER TABLE "inventory"."stock" ADD COLUMN IF NOT EXISTS "created_at"',
    );
    // reservation_item — uchala ustun
    expect(all).toContain(
      'ALTER TABLE "inventory"."reservation_item" ADD COLUMN IF NOT EXISTS "created_at"',
    );
    expect(all).toContain(
      'ALTER TABLE "inventory"."reservation_item" ADD COLUMN IF NOT EXISTS "updated_at"',
    );
    // append-only jurnalga updated_at
    expect(all).toContain(
      'ALTER TABLE "inventory"."stock_movement" ADD COLUMN IF NOT EXISTS "updated_at"',
    );
  });

  it('rollback qo‘shilgan ustunlarni o‘chiradi', async () => {
    const query = jest.fn(async (_sql: string) => undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new AddInventoryBaseColumns1721822400003().down(queryRunner);

    const all = query.mock.calls
      .map((c) => String(c[0]).replace(/\s+/g, ' ').trim())
      .join('\n');
    expect(all).toContain(
      'ALTER TABLE "inventory"."warehouse" DROP COLUMN IF EXISTS "is_deleted"',
    );
    expect(all).toContain(
      'ALTER TABLE "inventory"."reservation_item" DROP COLUMN IF EXISTS "created_at"',
    );
  });
});
