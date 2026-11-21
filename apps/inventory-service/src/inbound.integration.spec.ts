import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import { InboundShipmentStatus, LOT_BLOCKED_EVENT } from '@app/common';
import { INVENTORY_DB } from './database';
import { InboundService } from './inbound.service';
import { InventoryService } from './inventory.service';
import { ReturnInspectionService } from './return-inspection.service';
import { Stock } from './entities/stock.entity';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
const INVENTORY_SCHEMA_TEST_LOCK = 2_304_005;
const WHOLESALER = '15';

/** Bugundan `days` kun keyingi sana (Toshkent). */
const inDays = (days: number) => {
  const today = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Tashkent',
  });
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** BE-17 haqiqiy PostgreSQL da: postavka qabuli, partiya muddati, qaytganlarni saralash. */
describeWithPostgres('BE-17 ombor qabuli va saralash (PostgreSQL)', () => {
  let lock: Client | undefined;
  let ds: DataSource;
  let inventory: InventoryService;
  let inbound: InboundService;
  let returns: ReturnInspectionService;
  let hqId: string;
  const notifications = { emit: jest.fn(() => of(undefined)) };
  // katalog: mahsulot → yagona variant (BE-07), optovik rekvizitlari, variant nomlari
  const catalog = {
    send: jest.fn((pattern: { cmd: string }, data: Record<string, unknown>) => {
      if (pattern.cmd === 'catalog.inventory.products')
        return of(
          (data.productIds as string[]).map((productId) => ({
            productId,
            productName: `Mahsulot ${productId}`,
            variantId: String(Number(productId) + 800),
            sku: `SKU-${productId}`,
            barcode: `47800${productId}`,
            wholesalerId: productId === '99' ? '16' : WHOLESALER,
            isBad: productId === '43',
          })),
        );
      if (pattern.cmd === 'catalog.wholesaler.admin-get')
        return of({
          name: 'Gadget Trade MChJ',
          tin: '305123456',
          contractNumber: 'K-12',
          contractDate: '2026-11-01',
        });
      if (pattern.cmd === 'inventory.variant-details')
        return of(
          (data.variantIds as string[]).map((variantId) => ({
            variantId,
            productName: `Mahsulot ${Number(variantId) - 800}`,
            sku: `SKU-${Number(variantId) - 800}`,
          })),
        );
      throw new Error(`kutilmagan katalog so‘rovi: ${pattern.cmd}`);
    }),
  };

  const stockOf = (variantId: string) =>
    ds.getRepository(Stock).findOneByOrFail({ variantId, warehouseId: hqId });

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
    inbound = new InboundService(ds, catalog as never, notifications as never);
    returns = new ReturnInspectionService(ds, catalog as never);
    hqId = await inventory.hqWarehouseId();
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS inventory CASCADE');
      await ds.destroy();
    }
    await lock?.end();
  });

  it('TC1: omborchi optovik nomidan 100 dona e’lon qildi → 98 qabul, 2 brak → «Farq bor», qoldiq 96, akt PDF', async () => {
    const declared = await inbound.declare({
      wholesalerId: WHOLESALER,
      expectedAt: inDays(1),
      items: [{ productId: '42', quantity: 100 }],
      actorId: '61',
    });
    expect(declared).toMatchObject({
      status: 'DECLARED',
      number: expect.stringMatching(/^PS-\d{6}$/),
      items: [
        expect.objectContaining({
          variantId: '842',
          sku: 'SKU-42',
          declaredQty: 100,
        }),
      ],
    });
    await expect(inbound.inTransit({ id: declared.id })).resolves.toMatchObject(
      { status: 'IN_TRANSIT' },
    );
    const received = await inbound.receive({
      id: declared.id,
      items: [
        {
          itemId: declared.items[0].id,
          receivedQty: 98,
          defectiveQty: 2,
          batch: 'P-11',
          cell: 'B-02-1',
        },
      ],
      comment: '2 dona qadog‘i yirtilgan',
      actorId: '61',
    });
    expect(received).toMatchObject({
      status: InboundShipmentStatus.DISCREPANCY,
      receivedBy: '61',
      items: [
        expect.objectContaining({
          receivedQty: 98,
          defectiveQty: 2,
          cell: 'B-02-1',
        }),
      ],
    });
    // qoldiqqa faqat yaroqli soni (98 − 2), yacheyka SKU da
    expect(await stockOf('842')).toMatchObject({
      quantityOnHand: 96,
      cell: 'B-02-1',
    });
    await expect(inventory.available(['842'])).resolves.toEqual({ '842': 96 });
    // takroriy qabul — o‘sha natija, qoldiq ikki marta oshmaydi
    await inbound.receive({
      id: declared.id,
      items: [
        {
          itemId: declared.items[0].id,
          receivedQty: 98,
          defectiveQty: 2,
          cell: 'B-02-1',
        },
      ],
      actorId: '61',
    });
    expect((await stockOf('842')).quantityOnHand).toBe(96);
    const act = await inbound.actPdf({ id: declared.id });
    expect(act.fileName).toBe(`qabul-akti_${declared.number}.pdf`);
    const pdf = Buffer.from(act.base64, 'base64').toString('latin1');
    expect(pdf.startsWith('%PDF')).toBe(true);
    // matn glif kodlari bilan yoziladi — sarlavha (metadata) va komitent so‘rovi tekshiriladi
    expect(pdf).toContain(`Qabul akti ${declared.number}`);
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'catalog.wholesaler.admin-get' },
      { id: WHOLESALER },
    );
  });

  it('e’lon: boshqa optovik mahsuloti yoki takroriy mahsulot — 400; qabulda hamma qator shart', async () => {
    await expect(
      inbound.declare({
        wholesalerId: WHOLESALER,
        expectedAt: inDays(1),
        items: [{ productId: '99', quantity: 5 }],
        actorId: '61',
      }),
    ).rejects.toThrow('boshqa optovikniki');
    const shipment = await inbound.declare({
      wholesalerId: WHOLESALER,
      expectedAt: inDays(1),
      items: [
        { productId: '44', quantity: 5 },
        { productId: '45', quantity: 5 },
      ],
      actorId: '61',
    });
    await expect(
      inbound.receive({
        id: shipment.id,
        items: [
          {
            itemId: shipment.items[0].id,
            receivedQty: 5,
            defectiveQty: 0,
            cell: 'A-1',
          },
        ],
        actorId: '61',
      }),
    ).rejects.toThrow('hamma qatori');
  });

  it('TC2: muddatiga 50 kun qolgan partiya qoldiqda hisoblanmaydi va sotilmaydi; adminga xabar; 90 kunligi sotiladi', async () => {
    const shipment = await inbound.declare({
      wholesalerId: WHOLESALER,
      expectedAt: inDays(0),
      items: [{ productId: '43', quantity: 10 }],
      actorId: '61',
    });
    notifications.emit.mockClear();
    await inbound.receive({
      id: shipment.id,
      items: [
        {
          itemId: shipment.items[0].id,
          receivedQty: 10,
          defectiveQty: 0,
          batch: 'BAD-1',
          expiryDate: inDays(50),
          cell: 'C-01',
        },
      ],
      actorId: '61',
    });
    expect((await stockOf('843')).quantityOnHand).toBe(10);
    await expect(inventory.available(['843'])).resolves.toEqual({ '843': 0 });
    await expect(
      inventory.reserveAvailable({
        orderRef: '7001',
        items: [{ variantId: '843', quantity: 1 }],
        idempotencyKey: 'r-7001',
      }),
    ).rejects.toBeDefined();
    expect(notifications.emit).toHaveBeenCalledWith(
      LOT_BLOCKED_EVENT,
      expect.objectContaining({
        lots: [expect.objectContaining({ batch: 'BAD-1', quantity: 10 })],
      }),
    );
    // xabar bir marta (kunlik tekshiruv qayta yubormaydi)
    notifications.emit.mockClear();
    await inbound.dailyBlocked();
    expect(notifications.emit).not.toHaveBeenCalled();
    await expect(inbound.lots({ state: 'BLOCKED' })).resolves.toEqual([
      expect.objectContaining({
        sku: 'SKU-43',
        expiryDate: inDays(50),
        sellableUntil: inDays(-10),
        blocked: true,
      }),
    ]);

    // yangi partiya 90 kunlik — sotiladi, chiqim avval sotiladiganidan (FEFO), eski partiyaga tegmaydi
    const fresh = await inbound.declare({
      wholesalerId: WHOLESALER,
      expectedAt: inDays(0),
      items: [{ productId: '43', quantity: 4 }],
      actorId: '61',
    });
    await inbound.receive({
      id: fresh.id,
      items: [
        {
          itemId: fresh.items[0].id,
          receivedQty: 4,
          defectiveQty: 0,
          batch: 'BAD-2',
          expiryDate: inDays(90),
          cell: 'C-01',
        },
      ],
      actorId: '61',
    });
    await expect(inventory.available(['843'])).resolves.toEqual({ '843': 4 });
    await inventory.reserveAvailable({
      orderRef: '7002',
      items: [{ variantId: '843', quantity: 3 }],
      idempotencyKey: 'r-7002',
    });
    await inventory.commit({ orderRef: '7002', idempotencyKey: 'c-7002' });
    const lots = await inbound.lots({ state: 'ALL' });
    expect(lots.map((lot) => [lot.batch, lot.quantity])).toEqual([
      ['BAD-1', 10],
      ['BAD-2', 1],
    ]);
    await expect(inventory.available(['843'])).resolves.toEqual({ '843': 1 });
  });

  it('TC3: qaytgan tovar — sotiladigan qoldiqqa +1, brak qoldiqqa kirmaydi va brak akti; takror — o‘sha natija', async () => {
    const shipment = await inbound.declare({
      wholesalerId: WHOLESALER,
      expectedAt: inDays(0),
      items: [{ productId: '46', quantity: 5 }],
      actorId: '61',
    });
    await inbound.receive({
      id: shipment.id,
      items: [
        {
          itemId: shipment.items[0].id,
          receivedQty: 5,
          defectiveQty: 0,
          cell: 'D-1',
        },
      ],
      actorId: '61',
    });
    // buyurtma: 2 dona band → topshirishda chiqim (BE-16/BE-19)
    await inventory.reserveAvailable({
      orderRef: '7101',
      items: [{ variantId: '846', quantity: 2 }],
      idempotencyKey: 'r-7101',
    });
    await inventory.commit({ orderRef: '7101', idempotencyKey: 'c-7101' });
    expect((await stockOf('846')).quantityOnHand).toBe(3);

    // hamma dona saralanishi shart
    await expect(
      returns.grade({
        orderRef: '7101',
        items: [{ variantId: '846', sellable: 1, defective: 0 }],
        actorId: '61',
      }),
    ).rejects.toThrow('hamma tovar');
    const graded = await returns.grade({
      orderRef: '7101',
      parcelId: '55',
      items: [{ variantId: '846', sellable: 1, defective: 1 }],
      comment: 'Bittasi ezilgan',
      actorId: '61',
    });
    expect(graded).toMatchObject({
      orderId: '7101',
      parcelId: '55',
      items: [{ variantId: '846', sellable: 1, defective: 1 }],
      inspectedBy: '61',
    });
    expect((await stockOf('846')).quantityOnHand).toBe(4); // +1 sotiladigan
    await returns.grade({
      orderRef: '7101',
      items: [{ variantId: '846', sellable: 2, defective: 0 }],
      actorId: '61',
    });
    expect((await stockOf('846')).quantityOnHand).toBe(4); // takror — o‘zgarmaydi
    const movements = (await ds.query(
      `SELECT type, quantity FROM inventory.stock_movement
        WHERE reference_type = 'RETURN_INSPECTION' ORDER BY id`,
    )) as Array<{ type: string; quantity: number }>;
    expect(movements).toEqual([
      { type: 'RETURN', quantity: 1 },
      { type: 'DEFECT', quantity: 1 },
    ]);
    const act = await returns.defectActPdf({
      orderRef: '7101',
      shipmentId: '1251177',
    });
    expect(act.fileName).toBe('brak-akti_7101.pdf');
    expect(
      Buffer.from(act.base64, 'base64').toString('latin1').startsWith('%PDF'),
    ).toBe(true);
  });

  it('chiqim qilinmagan buyurtma saralanmaydi (409)', async () => {
    await expect(
      returns.grade({
        orderRef: '7999',
        items: [{ variantId: '846', sellable: 1, defective: 0 }],
        actorId: '61',
      }),
    ).rejects.toThrow('chiqim qilinmagan');
  });
});
