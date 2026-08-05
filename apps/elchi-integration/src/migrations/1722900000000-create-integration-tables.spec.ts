import { QueryRunner } from 'typeorm';
import { CreateIntegrationTables1722900000000 } from './1722900000000-create-integration-tables';

describe('CreateIntegrationTables1722900000000', () => {
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

  it('integration schema jadvallarini (provision + geo_cache) yaratadi', async () => {
    await new CreateIntegrationTables1722900000000().up(queryRunner);
    const all = queries.join(' ');

    expect(all).toContain(
      'CREATE TABLE "integration"."elchi_market_provision"',
    );
    expect(all).toContain('CREATE TABLE "integration"."geo_cache"');
    // idempotentlik + geo unikal indekslari
    expect(all).toContain(
      'CONSTRAINT "uq_integration_market_provision_shop" UNIQUE ("shop_id")',
    );
    expect(all).toContain(
      'CONSTRAINT "uq_integration_geo_kind_elchi" UNIQUE ("kind", "elchi_id")',
    );
    // BaseEntity ustunlari
    expect(all).toContain('"is_deleted" BOOLEAN NOT NULL DEFAULT FALSE');
  });

  it('rollback ikkala jadvalni o‘chiradi', async () => {
    await new CreateIntegrationTables1722900000000().down(queryRunner);
    const all = queries.join(' ');
    expect(all).toContain('DROP TABLE "integration"."geo_cache"');
    expect(all).toContain('DROP TABLE "integration"."elchi_market_provision"');
  });
});
