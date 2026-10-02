import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import { OutboxEvent } from '@app/common';
import { AdminInventoryQueryService } from './admin-inventory-query.service';
import { InventoryOperation } from './entities/inventory-operation.entity';
import { ReservationItem } from './entities/reservation-item.entity';
import { Reservation } from './entities/reservation.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { Stock } from './entities/stock.entity';
import { Warehouse } from './entities/warehouse.entity';
import { CreateInventoryTables1721822400000 } from './migrations/1721822400000-create-inventory-tables';
import { CreateInventoryOperation1721822400001 } from './migrations/1721822400001-create-inventory-operation';
import { CreateInventoryOutbox1721822400002 } from './migrations/1721822400002-create-inventory-outbox';
import { AddInventoryBaseColumns1721822400003 } from './migrations/1721822400003-add-inventory-base-columns';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/**
 * C6.7 — admin qoldig'i HAQIQIY Postgres'da: TypeORM OFFSET/LIMIT + JOIN
 * sahifalash, ombor faolligi filtri va katalog qidiruvining SQL'ga tushishi.
 * Katalog RPC'si soxta (u boshqa servis) — 85-variant "o'chirilgan".
 */
describeWithPostgres('AdminInventoryQueryService PostgreSQL (C6.7)', () => {
  let dataSource: DataSource;
  let service: AdminInventoryQueryService;

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
    });
    await dataSource.initialize();

    // do'kon 15: faol ombor 3 (5 variant) + o'chirilgan ombor 4; do'kon 16; HQ
    await dataSource.query(`
      INSERT INTO inventory.warehouse (id,owner_type,owner_id,name,is_active) VALUES
        (3,'SHOP',15,'Asosiy',true),(4,'SHOP',15,'Eski',false),
        (5,'SHOP',16,'Chilonzor',true),(6,'HQ',1,'HQ',true)`);
    await dataSource.query(`
      INSERT INTO inventory.stock
        (id,variant_id,warehouse_id,quantity_on_hand,quantity_reserved,low_stock_threshold) VALUES
        (1,81,3,10,2,3),(2,82,3,1,0,5),(3,83,3,7,0,1),(4,84,3,2,1,2),
        (5,85,3,9,0,0),(6,86,4,4,0,1),(7,91,5,3,0,1),(8,99,6,100,0,0)`);
    await dataSource.query(`
      INSERT INTO inventory.stock_movement
        (stock_id,variant_id,warehouse_id,type,quantity,on_hand_after,reserved_after) VALUES
        (1,81,3,'INBOUND',10,10,0),(6,86,4,'INBOUND',4,4,0),(7,91,5,'INBOUND',3,3,0)`);

    const catalog = {
      send: (pattern: { cmd: string }, data: { variantIds?: string[] }) =>
        pattern.cmd === 'catalog.admin.variant-search'
          ? of({ variantIds: ['82', '86', '91'], truncated: false })
          : of(
              (data.variantIds ?? [])
                .filter((id) => id !== '85')
                .map((id) => ({
                  variantId: id,
                  productId: '1',
                  productName: `P${id}`,
                  variantName: null,
                  sku: `S${id}`,
                })),
            ),
    };
    service = new AdminInventoryQueryService(
      dataSource.getRepository(Stock),
      dataSource.getRepository(StockMovement),
      catalog as never,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  const stock = (query: Record<string, unknown> = {}) =>
    service.stock({ page: 1, limit: 20, lowOnly: false, ...query });

  it('TC1: barcha do‘kon omborlari (o‘chirilgani ham), HQ yo‘q', async () => {
    const page = await stock();
    expect(page.total).toBe(7);
    expect(page.items.find((row) => row.variantId === '86')).toMatchObject({
      warehouseActive: false,
    });
    expect(page.items.find((row) => row.variantId === '85')).toMatchObject({
      catalogMissing: true,
      productName: null,
    });
  });

  it('SQL sahifalash: sahifalar kesishmaydi, hech narsa yo‘qolmaydi', async () => {
    const pages = await Promise.all(
      [1, 2, 3].map((page) => stock({ page, limit: 3 })),
    );
    expect(pages.map((page) => page.items.length)).toEqual([3, 3, 1]);
    expect(pages[0]).toMatchObject({ total: 7, totalPages: 3 });
    const ids = new Set(
      pages.flatMap((page) => page.items.map((row) => row.variantId)),
    );
    expect(ids.size).toBe(7);
  });

  it('filtrlar: ombor faolligi, kam qoldiq, qidiruv, do‘kon', async () => {
    await expect(stock({ warehouseActive: true })).resolves.toMatchObject({
      total: 6,
    });
    const inactive = await stock({ warehouseActive: false });
    expect(inactive.items.map((row) => row.variantId)).toEqual(['86']);
    const low = await stock({ lowOnly: true });
    expect(low.items.map((row) => row.variantId).sort()).toEqual(['82', '84']);
    const search = await stock({ search: 'telefon' });
    expect(search.items.map((row) => row.variantId).sort()).toEqual([
      '82',
      '86',
      '91',
    ]);
    await expect(stock({ shopId: '16' })).resolves.toMatchObject({ total: 1 });
  });

  it('TC2: harakatlar qoldiq bilan bir xil ombor filtri, mahsulot nomi bilan', async () => {
    await expect(
      service.movementList({ page: 1, limit: 20 }),
    ).resolves.toMatchObject({
      total: 3,
    });
    const inactive = await service.movementList({
      page: 1,
      limit: 20,
      warehouseActive: false,
    });
    expect(inactive.items).toEqual([
      expect.objectContaining({
        variantId: '86',
        warehouseActive: false,
        productName: 'P86',
      }),
    ]);
  });
});
