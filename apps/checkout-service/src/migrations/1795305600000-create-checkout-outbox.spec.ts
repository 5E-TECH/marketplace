import { CreateCheckoutOutbox1795305600000 } from './1795305600000-create-checkout-outbox';

describe('CreateCheckoutOutbox1795305600000 (BE-03)', () => {
  it('checkout.outbox_event jadvali va (status, id) indeksini yaratadi, down o‘chiradi', async () => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => queries.push(sql)) };
    const migration = new CreateCheckoutOutbox1795305600000();

    await migration.up(runner as never);
    expect(queries[0]).toContain('CREATE TABLE "checkout"."outbox_event"');
    expect(queries[0]).toContain(
      "CHECK (\"status\" IN ('PENDING', 'PROCESSED', 'FAILED'))",
    );
    expect(queries[1]).toContain(
      'ON "checkout"."outbox_event" ("status", "id")',
    );

    queries.length = 0;
    await migration.down(runner as never);
    expect(queries).toEqual(['DROP TABLE "checkout"."outbox_event"']);
  });
});
