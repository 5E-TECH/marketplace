import { QueryRunner } from 'typeorm';
import { CreateCatalogTables1721736000000 } from './1721736000000-create-catalog-tables';

describe('CreateCatalogTables1721736000000', () => {
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

  it('TC1: catalog schema ichida 4 ta jadval yaratadi', async () => {
    await new CreateCatalogTables1721736000000().up(queryRunner);

    const createTables = queries.filter((sql) =>
      sql.startsWith('CREATE TABLE'),
    );
    expect(createTables).toHaveLength(4);
    expect(createTables.join(' ')).toEqual(
      expect.stringContaining('"catalog"."shop"'),
    );
    expect(createTables.join(' ')).toEqual(
      expect.stringContaining('"catalog"."category"'),
    );
    expect(createTables.join(' ')).toEqual(
      expect.stringContaining('"catalog"."product"'),
    );
    expect(createTables.join(' ')).toEqual(
      expect.stringContaining('"catalog"."product_variant"'),
    );
  });

  it('TC2/TC3: shop slug va variant SKU unique', async () => {
    await new CreateCatalogTables1721736000000().up(queryRunner);
    const sql = queries.join(' ');

    expect(sql).toContain('CONSTRAINT "uq_catalog_shop_slug" UNIQUE ("slug")');
    expect(sql).toContain(
      'CONSTRAINT "uq_catalog_product_variant_sku" UNIQUE ("sku")',
    );
  });

  it('TC4: category parent_id o‘z jadvaliga FK', async () => {
    await new CreateCatalogTables1721736000000().up(queryRunner);

    expect(queries.join(' ')).toContain(
      'FOREIGN KEY ("parent_id") REFERENCES "catalog"."category"("id")',
    );
  });

  it('rollback jadvallarni dependency tartibida o‘chiradi', async () => {
    await new CreateCatalogTables1721736000000().down(queryRunner);

    expect(queries).toEqual([
      'DROP TABLE "catalog"."product_variant"',
      'DROP TABLE "catalog"."product"',
      'DROP TABLE "catalog"."category"',
      'DROP TABLE "catalog"."shop"',
    ]);
  });
});
