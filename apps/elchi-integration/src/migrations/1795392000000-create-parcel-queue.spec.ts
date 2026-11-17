import { CreateParcelQueue1795392000000 } from './1795392000000-create-parcel-queue';

describe('CreateParcelQueue1795392000000 (BE-20)', () => {
  it('posilka navbati, outbox va processed_event jadvallarini yaratadi; down teskari tartibda', async () => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => queries.push(sql)) };
    const migration = new CreateParcelQueue1795392000000();

    await migration.up(runner as never);
    const sql = queries.join('\n');
    expect(sql).toContain('CREATE TABLE "integration"."parcel_request"');
    expect(sql).toContain('UNIQUE ("order_id")');
    expect(sql).toContain('CREATE TABLE "integration"."outbox_event"');
    expect(sql).toContain('CREATE TABLE "integration"."processed_event"');

    queries.length = 0;
    await migration.down(runner as never);
    expect(queries).toEqual([
      'DROP TABLE "integration"."processed_event"',
      'DROP TABLE "integration"."outbox_event"',
      'DROP TABLE "integration"."parcel_request"',
    ]);
  });
});
