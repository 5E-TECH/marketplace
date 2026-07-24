import { QueryRunner } from 'typeorm';
import { CreateInventoryOutbox1721822400002 } from './1721822400002-create-inventory-outbox';

describe('CreateInventoryOutbox1721822400002', () => {
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

  it('PENDING eventlar uchun outbox jadvali va index yaratadi', async () => {
    await new CreateInventoryOutbox1721822400002().up(queryRunner);

    expect(queries.join(' ')).toContain(
      'CREATE TABLE "inventory"."outbox_event"',
    );
    expect(queries.join(' ')).toContain(
      '"status" VARCHAR(15) NOT NULL DEFAULT \'PENDING\'',
    );
    expect(queries.join(' ')).toContain(
      'CREATE INDEX "idx_inventory_outbox_event_status_created"',
    );
  });

  it('rollback outbox jadvalini o‘chiradi', async () => {
    await new CreateInventoryOutbox1721822400002().down(queryRunner);

    expect(queries).toEqual(['DROP TABLE "inventory"."outbox_event"']);
  });
});
