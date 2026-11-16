import { QueryRunner } from 'typeorm';
import { CreateLeadTables1794787200000 } from './1794787200000-create-lead-tables';

const TABLES = [
  'stream',
  'click',
  'lead',
  'lead_attempt',
  'lead_history',
  'operator_state',
  'postback_delivery',
  'capi_delivery',
  'affiliate_api_key',
  'outbox_event',
];

describe('CreateLeadTables1794787200000 (BE-10)', () => {
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

  it('lead sxemasida hamma jadvalni yaratadi, CREATE SCHEMA qilmaydi', async () => {
    await new CreateLeadTables1794787200000().up(queryRunner);
    const all = queries.join(' ');
    for (const table of TABLES)
      expect(all).toContain(`CREATE TABLE "lead"."${table}"`);
    expect(all).not.toMatch(/CREATE SCHEMA/i);
  });

  it('variant faqat s1, s3 yoki bo‘sh (LID-8)', async () => {
    await new CreateLeadTables1794787200000().up(queryRunner);
    const all = queries.join(' ');
    for (const table of ['click', 'lead'])
      expect(all).toContain(
        `CONSTRAINT "chk_lead_${table}_variant" CHECK ("variant" IS NULL OR "variant" IN ('s1', 's3'))`,
      );
  });

  it('API dan boshqa lidda manzil va yetkazish turi majburiy (LID-2, P-1)', async () => {
    await new CreateLeadTables1794787200000().up(queryRunner);
    const all = queries.join(' ');
    expect(all).toContain('CONSTRAINT "chk_lead_lead_address_required"');
    expect(all).toContain("\"where_deliver\" IN ('CENTER', 'ADDRESS')");
  });

  it('operator navbati uchun (status, next_attempt_at) indeksi bor', async () => {
    await new CreateLeadTables1794787200000().up(queryRunner);
    expect(queries.join(' ')).toContain(
      'CREATE INDEX "idx_lead_lead_status_next_attempt" ON "lead"."lead" ("status", "next_attempt_at")',
    );
  });

  it('rollback hamma jadvalni teskari tartibda o‘chiradi', async () => {
    await new CreateLeadTables1794787200000().down(queryRunner);
    const dropped = queries.map((q) => /"lead"\."(\w+)"/.exec(q)?.[1]);
    expect(dropped).toEqual([...TABLES].reverse());
  });
});
