import { QueryRunner } from 'typeorm';
import { MoneyToBigint1795219200000 } from './1795219200000-money-to-bigint';

describe('MoneyToBigint1795219200000 (BE-01, checkout-service)', () => {
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
    for (const col of [
      'total_amount',
      'delivery_fee',
      'subtotal',
      'cod_amount',
      'delivery_fee',
      'elchi_to_be_paid',
      'unit_price',
      'line_total',
      'requested_amount',
      'refunded_amount',
      'unit_price',
      'line_total',
      'unit_price_snapshot',
    ])
      expect(all).toContain(
        `ALTER COLUMN "${col}" TYPE BIGINT USING round("${col}")::bigint`,
      );
    for (const t of [
      'ALTER TABLE "checkout"."sales_order"',
      'ALTER TABLE "checkout"."sales_order_seller"',
      'ALTER TABLE "checkout"."sales_order_item"',
      'ALTER TABLE "checkout"."return_request"',
      'ALTER TABLE "checkout"."return_request_item"',
      'ALTER TABLE "checkout"."cart_item"',
    ])
      expect(all).toContain(t);
    expect(all).not.toMatch(/rating|commission_percent/);
  });

  it('rollback NUMERIC(14,2) ga qaytaradi', async () => {
    await new MoneyToBigint1795219200000().down(queryRunner);
    expect(queries.join(' ')).toContain('TYPE NUMERIC(14,2)');
  });
});
