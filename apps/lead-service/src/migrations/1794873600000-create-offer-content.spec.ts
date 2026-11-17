import { QueryRunner } from 'typeorm';
import { CreateOfferContent1794873600000 } from './1794873600000-create-offer-content';

describe('CreateOfferContent1794873600000 (BE-11)', () => {
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

  it('offer_content: mahsulot bo‘yicha unikal, ro‘yxatlar JSON massiv', async () => {
    await new CreateOfferContent1794873600000().up(queryRunner);
    const all = queries.join(' ');
    expect(all).toContain('CREATE TABLE "lead"."offer_content"');
    expect(all).toContain(
      'CONSTRAINT "uq_lead_offer_content_product" UNIQUE ("product_id")',
    );
    expect(all).toContain(`CHECK (jsonb_typeof("highlights") = 'array')`);
  });

  it('rollback jadvalni o‘chiradi', async () => {
    await new CreateOfferContent1794873600000().down(queryRunner);
    expect(queries).toEqual(['DROP TABLE IF EXISTS "lead"."offer_content"']);
  });
});
