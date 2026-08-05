import { CreateSearchIndex1722945600000 } from './1722945600000-create-search-index';

describe('CreateSearchIndex migration', () => {
  it('search document va GIN full-text indeksini yaratadi', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => queries.push(sql)),
    };
    await new CreateSearchIndex1722945600000().up(runner as never);
    const sql = queries.join('\n');
    expect(sql).toContain('"search"."search_document"');
    expect(sql).toContain('uq_search_document_product_id');
    expect(sql).toContain('USING GIN');
    expect(sql).toContain("to_tsvector('simple'");
  });
});
