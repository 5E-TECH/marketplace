import { QueryRunner } from 'typeorm';
import { ProductStatus } from '@app/common';
import { WholesalerCpaProduct1796083200000 } from './1796083200000-wholesaler-cpa-product';

describe('WholesalerCpaProduct1796083200000 (BE-07)', () => {
  const run = async (direction: 'up' | 'down') => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql.replace(/\s+/g, ' ').trim());
      }),
    } as unknown as QueryRunner;
    await new WholesalerCpaProduct1796083200000()[direction](runner);
    return queries.join('\n');
  };

  it('optovik: foydalanuvchisiz, OPT-1 rekvizitlari formati bilan; tariflar olib tashlanadi', async () => {
    const sql = await run('up');
    expect(sql).toContain(
      'ALTER TABLE "catalog"."shop" ALTER COLUMN "owner_user_id" DROP NOT NULL',
    );
    expect(sql).toContain(`"tin" ~ '^[0-9]{9}$'`);
    expect(sql).toContain(`"bank_account" ~ '^[0-9]{20}$'`);
    expect(sql).toContain(`"bank_mfo" ~ '^[0-9]{5}$'`);
    expect(sql).toContain('DROP COLUMN IF EXISTS "tariff_home"');
  });

  it('mahsulot: holat CHECK i enum bilan bir xil, sukut PENDING_REVIEW, slug global unikal (takrorlar ajratiladi)', async () => {
    const sql = await run('up');
    for (const status of Object.values(ProductStatus))
      expect(sql).toContain(`'${status}'`);
    expect(sql).toContain(`ALTER COLUMN "status" SET DEFAULT 'PENDING_REVIEW'`);
    expect(sql).toMatch(
      /SET "slug" = p\."slug" \|\| '-' \|\| p\."id".*o\."id" < p\."id"/,
    );
    expect(sql.indexOf('SET "slug"')).toBeLessThan(
      sql.indexOf('ADD CONSTRAINT "uq_catalog_product_slug" UNIQUE ("slug")'),
    );
    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS "uq_catalog_product_shop_slug"',
    );
    expect(sql).toContain('"weight_grams" IS NULL OR "weight_grams" > 0');
  });

  it('rollback eski CHECK, unikal (shop_id, slug) va tariflarni qaytaradi', async () => {
    const sql = await run('down');
    expect(sql).toContain(
      `CHECK ("status" IN ('DRAFT', 'ACTIVE', 'ARCHIVED', 'OUT_OF_STOCK'))`,
    );
    expect(sql).toContain('UNIQUE ("shop_id", "slug")');
    expect(sql).toContain('"tariff_home" BIGINT NOT NULL DEFAULT 25000');
  });
});
