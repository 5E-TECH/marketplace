import { QueryRunner } from 'typeorm';
import { CreateInventoryTables1721822400000 } from './1721822400000-create-inventory-tables';

describe('CreateInventoryTables1721822400000', () => {
  let queries: string[];
  let queryRunner: QueryRunner;

  beforeEach(() => {
    queries = [];
    queryRunner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql.replace(/\s+/g, ' ').trim());
      }),
    } as unknown as QueryRunner;
  });

  it('TC1: inventory schema ichida 5 ta jadval yaratadi', async () => {
    await new CreateInventoryTables1721822400000().up(queryRunner);

    const createTables = queries.filter((sql) =>
      sql.startsWith('CREATE TABLE'),
    );

    expect(createTables).toHaveLength(5);
    for (const table of [
      'warehouse',
      'stock',
      'stock_movement',
      'reservation',
      'reservation_item',
    ]) {
      expect(createTables.join(' ')).toContain(`"inventory"."${table}"`);
    }
  });

  it('TC2: har variant va ombor uchun stock yagona', async () => {
    await new CreateInventoryTables1721822400000().up(queryRunner);

    expect(queries.join(' ')).toContain(
      'CONSTRAINT "uq_inventory_stock_variant_warehouse" UNIQUE ("variant_id", "warehouse_id")',
    );
  });

  it('TC3: reservation order_ref yagona', async () => {
    await new CreateInventoryTables1721822400000().up(queryRunner);

    expect(queries.join(' ')).toContain(
      'CONSTRAINT "uq_inventory_reservation_order_ref" UNIQUE ("order_ref")',
    );
  });

  it('ichki FK va miqdor invariantlarini yaratadi', async () => {
    await new CreateInventoryTables1721822400000().up(queryRunner);
    const sql = queries.join(' ');

    expect(sql).toContain(
      'FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouse"("id")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("stock_id") REFERENCES "inventory"."stock"("id")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("reservation_id") REFERENCES "inventory"."reservation"("id")',
    );
    expect(sql).toContain('"quantity_reserved" <= "quantity_on_hand"');
    expect(sql).toContain('CHECK ("quantity" > 0)');
  });

  it('rollback jadvallarni dependency tartibida o‘chiradi', async () => {
    await new CreateInventoryTables1721822400000().down(queryRunner);

    expect(queries).toEqual([
      'DROP TABLE "inventory"."reservation_item"',
      'DROP TABLE "inventory"."reservation"',
      'DROP TABLE "inventory"."stock_movement"',
      'DROP TABLE "inventory"."stock"',
      'DROP TABLE "inventory"."warehouse"',
    ]);
  });
});
