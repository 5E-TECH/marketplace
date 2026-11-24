import { Client } from 'pg';
import { of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { InboundShipmentStatus, LOT_BLOCKED_EVENT } from '@app/common';
import { INVENTORY_DB } from './database';
import { InboundService } from './inbound.service';
import { InventoryService } from './inventory.service';
import { ReturnInspectionService } from './return-inspection.service';
import { WholesalerStockService } from './wholesaler-stock.service';
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
      // BE-25: ro‘yxat qidiruvi — optovik nomi bo‘yicha
      if (pattern.cmd === 'catalog.wholesaler.admin-list')
        return of({
          items: String(data.search).toLowerCase().includes('gadget')
            ? [{ id: WHOLESALER }]
            : [],
        });
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

  it('BE-47 TC2: qabul — optovik kabinetiga hodisa shu tranzaksiyada outbox’da (qabul, brak, e’lon qilingan)', async () => {
    const [row] = (await ds.query(
      `SELECT payload FROM inventory.outbox_event WHERE event_type = 'inventory.inbound.received' ORDER BY id LIMIT 1`,
    )) as Array<{ payload: Record<string, unknown> }>;
    expect(row.payload).toMatchObject({
      wholesalerId: WHOLESALER,
      number: expect.stringMatching(/^PS-\d{6}$/),
      status: 'DISCREPANCY',
      declaredQty: 100,
      receivedQty: 98,
      defectiveQty: 2,
    });
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
        // BE-25: partiya optovigi va xabar vaqti
        wholesalerId: WHOLESALER,
        notifiedAt: expect.any(Date),
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

  it('BE-25: ro‘yxat filtrlari — bir nechta holat, qidiruv, kelish sanasi, qabul kuni; sanoq holatdan mustaqil', async () => {
    const all = await inbound.list({ limit: 100 });
    const byStatus = (status: InboundShipmentStatus) =>
      all.items.filter((item) => item.status === status).map((item) => item.id);
    expect(all.total).toBe(all.items.length);
    for (const status of Object.values(InboundShipmentStatus))
      expect(all.counts[status]).toBe(byStatus(status).length);
    expect(byStatus(InboundShipmentStatus.RECEIVED).length).toBeGreaterThan(0);

    const two = await inbound.list({
      status: [
        InboundShipmentStatus.RECEIVED,
        InboundShipmentStatus.DISCREPANCY,
      ],
      limit: 100,
    });
    expect(two.items.map((item) => item.id).sort()).toEqual(
      [
        ...byStatus(InboundShipmentStatus.RECEIVED),
        ...byStatus(InboundShipmentStatus.DISCREPANCY),
      ].sort(),
    );
    expect(two.total).toBe(two.items.length);
    expect(two.counts).toEqual(all.counts); // yorliqlar soni holat filtriga bog‘liq emas
    // bitta holat (eski chaqiruv shakli)
    const one = await inbound.list({ status: InboundShipmentStatus.DECLARED });
    expect(one.items.map((item) => item.id)).toEqual(
      byStatus(InboundShipmentStatus.DECLARED),
    );

    const later = await inbound.declare({
      wholesalerId: '16',
      expectedAt: inDays(20),
      items: [{ productId: '99', quantity: 1 }],
      actorId: '61',
    });
    const ids = async (query: Parameters<InboundService['list']>[0]) =>
      (await inbound.list({ ...query, limit: 100 })).items.map((i) => i.id);
    await expect(ids({ search: later.number })).resolves.toEqual([later.id]);
    await expect(ids({ search: 'sku-99' })).resolves.toEqual([later.id]);
    await expect(ids({ search: '4780099' })).resolves.toEqual([later.id]);
    await expect(ids({ search: 'mahsulot 99' })).resolves.toEqual([later.id]);
    await expect(ids({ search: '%' })).resolves.toEqual([]); // joker emas, oddiy belgi
    const gadget = await ids({ search: 'gadget' });
    expect(gadget).toEqual(all.items.map((item) => item.id));
    await expect(
      ids({ expectedFrom: inDays(15), expectedTo: inDays(20) }),
    ).resolves.toEqual([later.id]);
    await expect(ids({ expectedFrom: inDays(21) })).resolves.toEqual([]);
    const receivedToday = await ids({ receivedOn: inDays(0) });
    expect(receivedToday.sort()).toEqual(
      two.items.map((item) => item.id).sort(),
    );
    await expect(ids({ receivedOn: inDays(-1) })).resolves.toEqual([]);
    // optovik bo‘yicha sanoq ham shu optovikniki
    const own = await inbound.list({ wholesalerId: '16' });
    expect(own).toMatchObject({
      total: 1,
      counts: { DECLARED: 1, IN_TRANSIT: 0, RECEIVED: 0, DISCREPANCY: 0 },
    });
    await expect(inbound.list({ receivedOn: '2026-02-30' })).rejects.toThrow(
      'receivedOn',
    );
  });

  it('BE-25: katalog javob bermasa ham qidiruv mahsulot va raqam bo‘yicha ishlaydi', async () => {
    const broken = new InboundService(
      ds,
      { send: () => throwError(() => new Error('katalog yo‘q')) } as never,
      notifications as never,
    );
    const found = await broken.list({ search: 'SKU-42' });
    expect(found.total).toBeGreaterThan(0);
  });

  it('BE-25 (OMB-2): yacheykalar variant bo‘yicha — noto‘g‘ri ID tashlanadi, qoldig‘i yo‘q variant chiqmaydi', async () => {
    await expect(
      inbound.variantCells(['842', '842', 'x', '123456']),
    ).resolves.toEqual([{ variantId: '842', cell: 'B-02-1' }]);
    await expect(inbound.variantCells([])).resolves.toEqual([]);
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

  it('hisobdan chiqarish: muddati o‘tgan partiya chiqariladi, yaxshi qoldiq sotuvga qaytadi; qoldiq ro‘yxatida yacheyka va blok', async () => {
    const shipment = await inbound.declare({
      wholesalerId: WHOLESALER,
      expectedAt: inDays(0),
      items: [
        { productId: '47', quantity: 4 },
        { productId: '48', quantity: 1 },
      ],
      actorId: '61',
    });
    const [first, second] = shipment.items;
    await inbound.receive({
      id: shipment.id,
      items: [
        {
          itemId: first.id,
          receivedQty: 4,
          defectiveQty: 0,
          batch: 'OLD',
          expiryDate: inDays(30),
          cell: 'E-1',
        },
        { itemId: second.id, receivedQty: 1, defectiveQty: 0, cell: 'E-2' },
      ],
      actorId: '61',
    });
    // muddatsiz 6 dona (masalan, qaytgan tovar) — sotiladi
    await inventory.inbound({
      variantId: '847',
      warehouseId: hqId,
      quantity: 6,
      reason: 'Muddatsiz qoldiq',
      actorId: '61',
      idempotencyKey: 'in-847',
    });
    await expect(inventory.available(['847'])).resolves.toEqual({ '847': 6 });
    // adjust tekshiruvlari sinxron tashlaydi — async bilan rad etilgan promise
    const adjust = async (delta: number, key: string, extra = {}) =>
      inventory.adjust({
        variantId: '847',
        warehouseId: hqId,
        quantityDelta: delta,
        reason: 'Hisobdan chiqarish',
        actorId: '61',
        idempotencyKey: key,
        ...extra,
      });
    // sotuvdan chiqqan partiya bor — nimani chiqarishni aytish majburiy (taxmin noto‘g‘ri qoldiq beradi)
    await expect(adjust(-2, 'wo-0')).rejects.toThrow('lotId');
    // yaxshi tovar (2 dona shikastlangan) — muddati o‘tgan partiyaga tegilmaydi
    await adjust(-2, 'wo-1', { goodStock: true });
    expect((await stockOf('847')).quantityOnHand).toBe(8);
    await expect(inventory.available(['847'])).resolves.toEqual({ '847': 4 });
    // muddati o‘tgan partiya — o‘zi chiqariladi, yaxshi qoldiq sotuvda qoladi
    const [old] = (await inbound.lots({ state: 'BLOCKED' })).filter(
      (lot) => lot.sku === 'SKU-47',
    );
    await adjust(-4, 'wo-2', { lotId: old.id });
    expect((await stockOf('847')).quantityOnHand).toBe(4);
    await expect(inventory.available(['847'])).resolves.toEqual({ '847': 4 });
    expect(
      (await inbound.lots({ state: 'ALL' })).filter(
        (lot) => lot.sku === 'SKU-47',
      ),
    ).toEqual([]);
    // boshqa SKU partiyasi yoki kirimda partiya — rad
    await expect(adjust(-1, 'wo-3', { lotId: '999999' })).rejects.toThrow(
      'Partiya topilmadi',
    );
    await expect(adjust(1, 'wo-4', { goodStock: true })).rejects.toThrow(
      'faqat hisobdan chiqarishda',
    );
  });

  it('ikki parallel qabul (qatorlar teskari tartibda) — deadlock yo‘q, ikkalasi o‘tadi', async () => {
    const make = () =>
      inbound.declare({
        wholesalerId: WHOLESALER,
        expectedAt: inDays(0),
        items: [
          { productId: '50', quantity: 3 },
          { productId: '51', quantity: 3 },
        ],
        actorId: '61',
      });
    const [a, b] = [await make(), await make()];
    const lines = (shipment: typeof a, reverse: boolean) => {
      const items = shipment.items.map((item) => ({
        itemId: item.id,
        receivedQty: 3,
        defectiveQty: 0,
        cell: 'F-1',
      }));
      return reverse ? items.reverse() : items;
    };
    for (let round = 0; round < 3; round++) {
      const [x, y] = [await make(), await make()];
      await Promise.all([
        inbound.receive({ id: x.id, items: lines(x, false), actorId: '61' }),
        inbound.receive({ id: y.id, items: lines(y, true), actorId: '61' }),
      ]);
    }
    await Promise.all([
      inbound.receive({ id: a.id, items: lines(a, false), actorId: '61' }),
      inbound.receive({ id: b.id, items: lines(b, true), actorId: '61' }),
    ]);
    expect((await stockOf('850')).quantityOnHand).toBe(24);
    expect((await stockOf('851')).quantityOnHand).toBe(24);
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
  it('BE-30 TC2: optovik paneli — omborda va bandda ombor jadvalining o‘zi; yo‘lda, mijozga yo‘lda, sotilgan (moliyadan), qaytgan, brak; boshqa optovik postavkasi kirmaydi', async () => {
    const received = await inbound.declare({
      wholesalerId: WHOLESALER,
      expectedAt: inDays(0),
      items: [{ productId: '48', quantity: 10 }],
      actorId: '61',
    });
    await inbound.receive({
      id: received.id,
      items: [
        {
          itemId: received.items[0].id,
          receivedQty: 10,
          defectiveQty: 1,
          cell: 'E-1',
        },
      ],
      actorId: '61',
    });
    // TC5: optovik e’lon qilgan, hali kelmagan — «yo‘lda»
    const pending = await inbound.declare({
      wholesalerId: WHOLESALER,
      expectedAt: inDays(2),
      items: [{ productId: '48', quantity: 7 }],
      actorId: '501',
    });
    expect(pending.status).toBe(InboundShipmentStatus.DECLARED);
    // 7201: 3 dona Elchi’ga topshirildi va hammasi qaytdi (2 sotiladigan, 1 brak) — sotilmagan
    await inventory.reserveAvailable({
      orderRef: '7201',
      items: [{ variantId: '848', quantity: 3 }],
      idempotencyKey: 'r-7201',
    });
    await inventory.commit({ orderRef: '7201', idempotencyKey: 'c-7201' });
    await returns.grade({
      orderRef: '7201',
      items: [{ variantId: '848', sellable: 2, defective: 1 }],
      actorId: '61',
    });
    // 7202: 2 dona topshirildi — moliyada 1 tasi yetkazilgan (sotilgan), 1 tasi hali mijozga yo‘lda
    await inventory.reserveAvailable({
      orderRef: '7202',
      items: [{ variantId: '848', quantity: 2 }],
      idempotencyKey: 'r-7202',
    });
    await inventory.commit({ orderRef: '7202', idempotencyKey: 'c-7202' });
    // 7203: 1 dona hali bandda
    await inventory.reserveAvailable({
      orderRef: '7203',
      items: [{ variantId: '848', quantity: 1 }],
      idempotencyKey: 'r-7203',
    });
    const variants = [
      {
        productId: '48',
        productName: 'Mahsulot 48',
        variantId: '848',
        sku: 'SKU-48',
      },
    ];
    const summary = await new WholesalerStockService(ds).summary({
      wholesalerId: WHOLESALER,
      variants,
      // moliya (finance.wholesaler.sold-units): boshqa mahsulot qatori panelga kirmaydi
      sold: [
        { productId: '48', quantity: 1 },
        { productId: '49', quantity: 5 },
      ],
    });
    const stock = await stockOf('848');
    expect(summary.items).toEqual([
      {
        productId: '48',
        productName: 'Mahsulot 48',
        variantId: '848',
        sku: 'SKU-48',
        onHand: stock.quantityOnHand,
        reserved: stock.quantityReserved,
        available: stock.quantityOnHand - stock.quantityReserved,
        inTransit: 7,
        outForDelivery: 1, // topshirilgan 5 − sotilgan 1 − qaytgan 2 − qaytgan brak 1
        sold: 1, // Elchi’ga topshirish (COMMIT 5) emas — moliyadagi sotuv
        returned: 2,
        defective: 2, // qabulda 1 + qaytganda 1
      },
    ]);
    expect(summary.items[0]).toMatchObject({ reserved: 1 });
    expect(summary.totals).toMatchObject({ outForDelivery: 1, sold: 1 });
    // bir mahsulotda ikkinchi (harakatsiz) variant ro‘yxatda birinchi tursa ham — sotilgan topshirgan variantga
    const twoVariants = await new WholesalerStockService(ds).summary({
      wholesalerId: WHOLESALER,
      variants: [
        {
          productId: '48',
          productName: 'Mahsulot 48',
          variantId: '847',
          sku: 'SKU-48-OLD',
        },
        ...variants,
      ],
      sold: [{ productId: '48', quantity: 1 }],
    });
    expect(
      twoVariants.items.map((i) => [i.variantId, i.sold, i.outForDelivery]),
    ).toEqual([
      ['847', 0, 0],
      ['848', 1, 1],
    ]);
    expect(twoVariants.totals).toMatchObject({ outForDelivery: 1, sold: 1 });
    // moliyada sotuv yo‘q — topshirilgan, qaytmagan ikkala dona mijozga yo‘lda; noto‘g‘ri son e’tiborsiz
    await expect(
      new WholesalerStockService(ds).summary({
        wholesalerId: WHOLESALER,
        variants,
        sold: [{ productId: '48', quantity: -3 }],
      }),
    ).resolves.toMatchObject({
      items: [{ sold: 0, outForDelivery: 2 }],
    });
    await expect(inventory.available(['848'])).resolves.toEqual({
      '848': summary.items[0].available,
    });
    expect(summary.totals).toMatchObject({
      onHand: stock.quantityOnHand,
      inTransit: 7,
    });
    // boshqa optovik e’loni bu optovik panelida yo‘q
    const other = await new WholesalerStockService(ds).summary({
      wholesalerId: '16',
      variants: [
        {
          productId: '48',
          productName: 'Mahsulot 48',
          variantId: '848',
          sku: 'SKU-48',
        },
      ],
    });
    expect(other.items[0]).toMatchObject({ inTransit: 0 });
  });
});
