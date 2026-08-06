import { QueryRunner } from 'typeorm';
import { AddUserShopOperator1722950000000 } from './1722950000000-add-user-shop-operator';

describe('AddUserShopOperator1722950000000', () => {
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

  it('shop_id ustuni + role CHECK’ga OPERATOR qo‘shadi', async () => {
    await new AddUserShopOperator1722950000000().up(queryRunner);
    const all = queries.join(' ');
    expect(all).toContain(
      'ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "shop_id" BIGINT',
    );
    expect(all).toContain(
      `CHECK ("role" IN ('BUYER', 'SELLER', 'OPERATOR', 'ADMIN', 'SUPERADMIN'))`,
    );
    expect(all).toContain('idx_identity_users_shop');
  });

  it('rollback shop_id ustunini o‘chiradi + eski CHECK’ni tiklaydi', async () => {
    await new AddUserShopOperator1722950000000().down(queryRunner);
    const all = queries.join(' ');
    expect(all).toContain(
      'ALTER TABLE "identity"."users" DROP COLUMN IF EXISTS "shop_id"',
    );
  });
});
