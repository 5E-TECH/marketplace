import { QueryRunner } from 'typeorm';
import { CreateInventoryOperation1721822400001 } from './1721822400001-create-inventory-operation';

describe('CreateInventoryOperation1721822400001', () => {
  it('idempotency natijasi uchun primary key jadvalini yaratadi', async () => {
    const query = jest.fn(async (_sql: string) => undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateInventoryOperation1721822400001().up(queryRunner);

    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, ' ').trim();
    expect(sql).toContain('CREATE TABLE "inventory"."inventory_operation"');
    expect(sql).toContain(
      'CONSTRAINT "pk_inventory_operation" PRIMARY KEY ("key")',
    );
    expect(sql).toContain('"response" JSONB NOT NULL');
  });

  it('rollback jadvalni o‘chiradi', async () => {
    const query = jest.fn(async (_sql: string) => undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateInventoryOperation1721822400001().down(queryRunner);

    expect(query).toHaveBeenCalledWith(
      'DROP TABLE "inventory"."inventory_operation"',
    );
  });
});
