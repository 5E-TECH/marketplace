import { QueryRunner } from 'typeorm';
import { MoneyToBigint1795219200000 } from './1795219200000-money-to-bigint';

describe('MoneyToBigint1795219200000 (BE-01, search-service)', () => {
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

  it('pul ustunlari BIGINT ga, round() bilan', async () => {
    await new MoneyToBigint1795219200000().up(queryRunner);
    const all = queries.join(' ');
    for (const col of ['price'])
      expect(all).toContain(
        `ALTER COLUMN "${col}" TYPE BIGINT USING round("${col}")::bigint`,
      );
    for (const t of ['ALTER TABLE "search"."search_document"'])
      expect(all).toContain(t);
    expect(all).not.toMatch(/rating|commission_percent/);
  });

  it('rollback NUMERIC(14,2) ga qaytaradi', async () => {
    await new MoneyToBigint1795219200000().down(queryRunner);
    expect(queries.join(' ')).toContain('TYPE NUMERIC(14,2)');
  });
});
