import { QueryRunner } from 'typeorm';
import { CreateAuthSession1721908800000 } from './1721908800000-create-auth-session';

describe('CreateAuthSession1721908800000', () => {
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

  it('refresh session va revoke ustunini yaratadi', async () => {
    await new CreateAuthSession1721908800000().up(queryRunner);
    const sql = queries.join(' ');

    expect(sql).toContain('CREATE TABLE "identity"."auth_session"');
    expect(sql).toContain('"token_hash" VARCHAR(64) NOT NULL');
    expect(sql).toContain('"revoked_at" TIMESTAMPTZ');
  });

  it('rollback auth_session jadvalini o‘chiradi', async () => {
    await new CreateAuthSession1721908800000().down(queryRunner);

    expect(queries).toEqual(['DROP TABLE "identity"."auth_session"']);
  });
});
