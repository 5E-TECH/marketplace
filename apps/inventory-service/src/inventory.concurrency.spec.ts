import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { OutboxEvent } from '@app/common';
import { InventoryOperation } from './entities/inventory-operation.entity';
import { ReservationItem } from './entities/reservation-item.entity';
import { Reservation } from './entities/reservation.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { Stock } from './entities/stock.entity';
import { Warehouse } from './entities/warehouse.entity';
import { InventoryService } from './inventory.service';
import { CreateInventoryTables1721822400000 } from './migrations/1721822400000-create-inventory-tables';
import { CreateInventoryOperation1721822400001 } from './migrations/1721822400001-create-inventory-operation';
import { CreateInventoryOutbox1721822400002 } from './migrations/1721822400002-create-inventory-outbox';
import { AddInventoryBaseColumns1721822400003 } from './migrations/1721822400003-add-inventory-base-columns';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres('InventoryService PostgreSQL concurrency', () => {
  let dataSource: DataSource;
  let service: InventoryService;

  beforeAll(async () => {
    const databaseUrl = new URL(testDatabaseUrl!);
    if (!databaseUrl.pathname.toLowerCase().includes('test')) {
      throw new Error(
        'TEST_DATABASE_URL faqat nomida "test" bor alohida bazaga ishora qilishi kerak',
      );
    }

    const admin = new Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query('DROP SCHEMA IF EXISTS inventory CASCADE');
    await admin.query('CREATE SCHEMA inventory');
    await admin.end();

    dataSource = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      schema: 'inventory',
      entities: [
        Warehouse,
        Stock,
        StockMovement,
        Reservation,
        ReservationItem,
        InventoryOperation,
        OutboxEvent,
      ],
      migrations: [
        CreateInventoryTables1721822400000,
        CreateInventoryOperation1721822400001,
        CreateInventoryOutbox1721822400002,
        AddInventoryBaseColumns1721822400003,
      ],
      migrationsRun: true,
      synchronize: false,
      logging: false,
      extra: { max: 60 },
    });
    await dataSource.initialize();
    service = new InventoryService(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE TABLE
        inventory.outbox_event,
        inventory.inventory_operation,
        inventory.reservation_item,
        inventory.reservation,
        inventory.stock_movement,
        inventory.stock,
        inventory.warehouse
      RESTART IDENTITY CASCADE
    `);
    await dataSource.query(`
      INSERT INTO inventory.warehouse (id, owner_type, owner_id, name)
      VALUES (201, 'SHOP', 1, 'Test ombor')
    `);
    await dataSource.query(`
      INSERT INTO inventory.stock (
        id, variant_id, warehouse_id, quantity_on_hand, quantity_reserved
      )
      VALUES (1, 101, 201, 100, 0)
    `);
  });

  it('TC1: happy-path reserve → commit qoldiqni to‘g‘ri yangilaydi', async () => {
    await service.reserve({
      orderRef: '1',
      items: [{ variantId: '101', warehouseId: '201', quantity: 5 }],
      idempotencyKey: 'happy-reserve',
    });
    await service.commit({
      orderRef: '1',
      idempotencyKey: 'happy-commit',
    });

    await expect(stockBalance()).resolves.toEqual({
      quantity_on_hand: 95,
      quantity_reserved: 0,
    });
  });

  it('TC2: parallel reserve×60 dan faqat bittasi o‘tadi, oversell bo‘lmaydi', async () => {
    const results = await Promise.allSettled([
      reserve('1', 60),
      reserve('2', 60),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    await expect(stockBalance()).resolves.toEqual({
      quantity_on_hand: 100,
      quantity_reserved: 60,
    });
  });

  it('TC3: 50 parallel reserve×2 aynan 100 ni band qiladi', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, index) => reserve(String(index + 1), 2)),
    );

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    await expect(stockBalance()).resolves.toEqual({
      quantity_on_hand: 100,
      quantity_reserved: 100,
    });
    const [{ count }] = await dataSource.query(
      'SELECT count(*)::int AS count FROM inventory.stock_movement',
    );
    expect(count).toBe(50);
  });

  it('TC4: parallel bir xil idempotency key faqat bir marta ta’sir qiladi', async () => {
    const results = await Promise.all([
      reserve('1', 2, 'same-key'),
      reserve('1', 2, 'same-key'),
    ]);

    expect(results[1]).toEqual(results[0]);
    await expect(stockBalance()).resolves.toEqual({
      quantity_on_hand: 100,
      quantity_reserved: 2,
    });
    const [{ count }] = await dataSource.query(
      'SELECT count(*)::int AS count FROM inventory.stock_movement',
    );
    expect(count).toBe(1);
  });

  function reserve(orderRef: string, quantity: number, key?: string) {
    return service.reserve({
      orderRef,
      items: [{ variantId: '101', warehouseId: '201', quantity }],
      idempotencyKey: key ?? `reserve-${orderRef}`,
    });
  }

  async function stockBalance() {
    const [stock] = await dataSource.query(`
      SELECT quantity_on_hand, quantity_reserved
      FROM inventory.stock
      WHERE id = 1
    `);
    return stock;
  }
});
