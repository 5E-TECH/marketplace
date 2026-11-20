import { Client } from 'pg';
import { of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { ErrorCode, StockMovementType } from '@app/common';
import { INVENTORY_DB } from './database';
import { AdminInventoryController } from './admin-inventory.controller';
import { AdminInventoryQueryService } from './admin-inventory-query.service';
import { InventoryService } from './inventory.service';
import { Stock } from './entities/stock.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { Warehouse } from './entities/warehouse.entity';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
/** inventory.concurrency.spec.ts bilan bir xil: inventory sxemasini DROP/CREATE qiladigan spec’lar ketma-ket. */
const INVENTORY_SCHEMA_TEST_LOCK = 2_304_005;

/**
 * BE-16 haqiqiy PostgreSQL da (hamma inventory migratsiyasi): bitta HQ ombor, tasdiqda band (TC1), topshirishda
 * chiqim (TC2), bekor qilinsa band darhol bo‘shaydi (TC3), oxirgi dona uchun ikki parallel band — bittasi rad (TC4);
 * sotuvchilar uchun bo‘sh qoldiq, qaytish turi va admin hisoboti (optovik — mahsulot egasi).
 */
describeWithPostgres('BE-16 HQ ombor (PostgreSQL)', () => {
  let lock: Client | undefined;
  let ds: DataSource;
  let inventory: InventoryService;
  let hqId: string;
  const variant = '501';

  const stockRow = () =>
    ds
      .getRepository(Stock)
      .findOneByOrFail({ variantId: variant, warehouseId: hqId });

  beforeAll(async () => {
    if (!new URL(url!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    lock = new Client({ connectionString: url });
    await lock.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [
      INVENTORY_SCHEMA_TEST_LOCK,
    ]);
    await lock.query('DROP SCHEMA IF EXISTS inventory CASCADE');
    await lock.query('CREATE SCHEMA inventory');
    ds = await new DataSource({
      type: 'postgres',
      url,
      schema: 'inventory',
      entities: INVENTORY_DB.entities as never,
      migrations: INVENTORY_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    inventory = new InventoryService(ds);
    hqId = await inventory.hqWarehouseId();
    await inventory.inbound({
      variantId: variant,
      warehouseId: hqId,
      quantity: 2,
      reason: 'Qabul (test)',
      actorId: '1',
      idempotencyKey: 'in-1',
    });
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS inventory CASCADE');
      await ds.destroy();
    }
    await lock?.end();
  });

  it('migratsiya: bitta faol HQ ombor; ikkinchisi — bazada rad', async () => {
    const hq = await ds
      .getRepository(Warehouse)
      .find({ where: { ownerType: 'HQ' } });
    expect(hq).toHaveLength(1);
    expect(hq[0]).toMatchObject({
      name: 'HQ ombor',
      isActive: true,
      ownerId: '0',
    });
    await expect(
      ds.query(
        `INSERT INTO inventory.warehouse (owner_type, owner_id, name) VALUES ('HQ', 0, 'Ikkinchi')`,
      ),
    ).rejects.toThrow(/uq_inventory_warehouse_single_hq/);
  });

  it('TC1: tasdiq → band +1, qoldiq o‘zgarmaydi; bo‘sh qoldiq kamayadi', async () => {
    await inventory.reserveAvailable({
      orderRef: '9001',
      items: [{ variantId: variant, quantity: 1 }],
      idempotencyKey: 'r-9001',
    });
    await expect(stockRow()).resolves.toMatchObject({
      quantityOnHand: 2,
      quantityReserved: 1,
    });
    await expect(inventory.available([variant, '999'])).resolves.toEqual({
      [variant]: 1,
      '999': 0,
    });
  });

  it('TC2: topshirish → qoldiq −1, band −1', async () => {
    await inventory.commit({ orderRef: '9001', idempotencyKey: 'c-9001' });
    await expect(stockRow()).resolves.toMatchObject({
      quantityOnHand: 1,
      quantityReserved: 0,
    });
  });

  it('TC3: bekor qilish → band −1 (darhol)', async () => {
    await inventory.reserveAvailable({
      orderRef: '9002',
      items: [{ variantId: variant, quantity: 1 }],
      idempotencyKey: 'r-9002',
    });
    await expect(stockRow()).resolves.toMatchObject({ quantityReserved: 1 });
    await inventory.release({ orderRef: '9002', idempotencyKey: 'x-9002' });
    await expect(stockRow()).resolves.toMatchObject({
      quantityOnHand: 1,
      quantityReserved: 0,
    });
  });

  it('TC4: oxirgi 1 dona uchun 2 parallel band → bittasi rad', async () => {
    const results = await Promise.allSettled(
      ['9003', '9004'].map((orderRef) =>
        inventory.reserveAvailable({
          orderRef,
          items: [{ variantId: variant, quantity: 1 }],
          idempotencyKey: `r-${orderRef}`,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    // rad sababi — qoldiq yetishmadi (boshqa xato emas)
    expect(rejected[0].reason).toMatchObject({
      errorCode: ErrorCode.INSUFFICIENT_STOCK,
    });
    await expect(stockRow()).resolves.toMatchObject({
      quantityOnHand: 1,
      quantityReserved: 1,
    });
  });

  it('qaytgan tovar omborga — RETURN turi bilan', async () => {
    const winner = (await ds.query(
      `SELECT order_ref::text AS "orderRef" FROM inventory.reservation WHERE status = 'HELD'`,
    )) as Array<{ orderRef: string }>;
    await inventory.commit({
      orderRef: winner[0].orderRef,
      idempotencyKey: 'c-last',
    });
    await inventory.returnOrderItems({
      orderRef: winner[0].orderRef,
      items: [{ variantId: variant, quantity: 1 }],
      idempotencyKey: 'ret-1',
      reason: 'Mijoz qaytardi',
    });
    const last = await ds.getRepository(StockMovement).findOne({
      where: { variantId: variant },
      order: { id: 'DESC' },
    });
    expect(last).toMatchObject({ type: StockMovementType.RETURN, quantity: 1 });
  });

  it('admin hisoboti: HQ qoldig‘i, optovik — mahsulot egasi (katalogdan), optovik filtri; katalog yiqilsa — ogohlantirish', async () => {
    const send = jest.fn(
      (pattern: { cmd: string }, data: Record<string, unknown>) => {
        if (pattern.cmd === 'catalog.admin.variant-search')
          return of({
            variantIds: data.wholesalerId === '15' ? [variant] : [],
            truncated: false,
          });
        return of([
          {
            wholesalerId: '15',
            variantId: variant,
            productId: '77',
            productName: 'Simsiz quloqchin',
            variantName: null,
            sku: 'Q-1',
          },
        ]);
      },
    );
    const admin = new AdminInventoryQueryService(
      ds.getRepository(Stock),
      ds.getRepository(StockMovement),
      { send } as never,
    );
    const page = await admin.stock({} as never);
    expect(page.items).toEqual([
      expect.objectContaining({
        shopId: '15',
        variantId: variant,
        productName: 'Simsiz quloqchin',
        warehouseName: 'HQ ombor',
        // 2 qabul − 1 topshirildi − 1 topshirildi + 1 qaytdi
        onHand: 1,
        reserved: 0,
        available: 1,
        catalogMissing: false,
      }),
    ]);
    await expect(admin.stock({ shopId: '15' } as never)).resolves.toMatchObject(
      {
        total: 1,
      },
    );
    await expect(admin.stock({ shopId: '16' } as never)).resolves.toMatchObject(
      {
        total: 0,
      },
    );
    const moves = await admin.movementList({ shopId: '15' } as never);
    expect(moves.items.length).toBeGreaterThan(0);
    expect(moves.items.every((m) => m.shopId === '15')).toBe(true);

    const broken = new AdminInventoryQueryService(
      ds.getRepository(Stock),
      ds.getRepository(StockMovement),
      {
        send: () => throwError(() => new Error('katalog javob bermadi')),
      } as never,
    );
    const degraded = await broken.stock({} as never);
    expect(degraded.items[0]).toMatchObject({
      shopId: null,
      catalogMissing: false,
    });
    // sendRpc noma’lum xatoni umumiy matnga aylantiradi — qator baribir qaytadi
    expect(degraded.warnings).toEqual([
      { shopId: null, reason: expect.any(String) },
    ]);
  });
  it('omborchi kirimi va tuzatish (vaqtinchalik yo‘l, BE-17 gacha): HQ ga yoziladi, takror kalit ikki marta qo‘shmaydi', async () => {
    const controller = new AdminInventoryController({} as never, inventory);
    const before = await stockRow();
    const inbound = {
      variantId: variant,
      quantity: 3,
      reason: 'Postavka (qo‘lda)',
      actorId: '7',
      idempotencyKey: 'hq-in-1',
    };
    await controller.hqInbound(inbound);
    await controller.hqInbound(inbound);
    await expect(stockRow()).resolves.toMatchObject({
      quantityOnHand: before.quantityOnHand + 3,
    });
    await controller.hqAdjust({
      variantId: variant,
      delta: -1,
      reason: 'Inventarizatsiya',
      actorId: '7',
      idempotencyKey: 'hq-adj-1',
    });
    await expect(stockRow()).resolves.toMatchObject({
      quantityOnHand: before.quantityOnHand + 2,
    });
    // band qilingandan kam bo‘lmaydi
    await inventory.reserveAvailable({
      orderRef: '9010',
      items: [{ variantId: variant, quantity: before.quantityOnHand + 2 }],
      idempotencyKey: 'r-9010',
    });
    await expect(
      controller.hqAdjust({
        variantId: variant,
        delta: -1,
        reason: 'Inventarizatsiya',
        actorId: '7',
        idempotencyKey: 'hq-adj-2',
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INSUFFICIENT_STOCK });
    const moves = await ds.getRepository(StockMovement).find({
      where: { variantId: variant, actorId: '7' },
      order: { id: 'ASC' },
    });
    expect(moves.map((m) => [m.type, m.quantity, m.warehouseId])).toEqual([
      [StockMovementType.INBOUND, 3, hqId],
      [StockMovementType.ADJUST, -1, hqId],
    ]);
  });
});
