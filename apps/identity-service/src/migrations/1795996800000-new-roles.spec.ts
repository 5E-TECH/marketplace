import { QueryRunner } from 'typeorm';
import { Role } from '@app/common';
import { NEW_ROLES, NewRoles1795996800000 } from './1795996800000-new-roles';

describe('NewRoles1795996800000 (BE-05)', () => {
  const runner = (oldRows: Array<{ role: string; count: number }> = []) => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql.replace(/\s+/g, ' ').trim());
        return sql.startsWith('SELECT') ? oldRows : undefined;
      }),
    } as unknown as QueryRunner;
    return { queries, queryRunner };
  };

  it('rol CHECK — aynan Role enumidagi sakkiz rol; shop_id va uning indeksi olib tashlanadi', async () => {
    expect([...NEW_ROLES].sort()).toEqual(Object.values(Role).sort());
    const { queries, queryRunner } = runner();
    await new NewRoles1795996800000().up(queryRunner);
    const all = queries.join(' ');
    expect(all).toContain(
      `CHECK ("role" IN ('AFFILIATE', 'WHOLESALER', 'OPERATOR_LEAD', 'SUPERVISOR', 'WAREHOUSE', 'FINANCE', 'ADMIN', 'SUPERADMIN'))`,
    );
    expect(all).not.toMatch(/'SELLER'|'BUYER'|'OPERATOR'[,)]/);
    expect(all).toContain(
      'DROP INDEX IF EXISTS "identity"."idx_identity_users_shop"',
    );
    expect(all).toContain(
      'ALTER TABLE "identity"."users" DROP COLUMN IF EXISTS "shop_id"',
    );
  });

  it('eski SELLER/BUYER qatorlari bor bazada hech narsani o‘zgartirmay to‘xtaydi (BE-40 — toza baza)', async () => {
    const { queries, queryRunner } = runner([
      { role: 'BUYER', count: 3 },
      { role: 'SELLER', count: 1 },
    ]);
    await expect(new NewRoles1795996800000().up(queryRunner)).rejects.toThrow(
      /eski rollar bor \(BUYER: 3, SELLER: 1\).*BE-40/,
    );
    expect(queries).toHaveLength(1);
  });

  it('rollback shop_id ni va eski CHECK ni qaytaradi', async () => {
    const { queries, queryRunner } = runner();
    await new NewRoles1795996800000().down(queryRunner);
    const all = queries.join(' ');
    expect(all).toContain('ADD COLUMN IF NOT EXISTS "shop_id" BIGINT');
    expect(all).toContain(
      `CHECK ("role" IN ('BUYER', 'SELLER', 'OPERATOR', 'ADMIN', 'SUPERADMIN'))`,
    );
  });
});
