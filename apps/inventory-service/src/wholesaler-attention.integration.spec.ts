import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import { AttentionVariant } from '@app/common';
import { INVENTORY_DB } from './database';
import { InboundService } from './inbound.service';
import { InventoryService } from './inventory.service';
import { ReturnInspectionService } from './return-inspection.service';
import { WholesalerAttentionService } from './wholesaler-attention.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
/** inbound.integration.spec bilan bir qulf — bitta `inventory` sxemasi. */
const INVENTORY_SCHEMA_TEST_LOCK = 2_304_005;
const W = '15';
const OTHER = '16';

const inDays = (days: number) => {
  const today = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Tashkent',
  });
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** BE-25 (FE-25) haqiqiy PostgreSQL da: «Diqqat talab qiladi» va optovik aktlari. */
describeWithPostgres(
  'BE-25: optovik «Diqqat talab qiladi» va aktlar (PostgreSQL)',
  () => {
    let lock: Client | undefined;
    let ds: DataSource;
    let inventory: InventoryService;
    let inbound: InboundService;
    let returns: ReturnInspectionService;
    let attention: WholesalerAttentionService;
    // katalog: mahsulot N → variant N+800, optovik 15 (99 — 16)
    const catalog = {
      send: jest.fn(
        (pattern: { cmd: string }, data: Record<string, unknown>) => {
          if (pattern.cmd === 'catalog.inventory.products')
            return of(
              (data.productIds as string[]).map((productId) => ({
                productId,
                productName: `Mahsulot ${productId}`,
                variantId: String(Number(productId) + 800),
                sku: `SKU-${productId}`,
                barcode: null,
                wholesalerId: productId === '99' ? OTHER : W,
                isBad: false,
              })),
            );
          throw new Error(`kutilmagan katalog so‘rovi: ${pattern.cmd}`);
        },
      ),
    };
    const v = (productId: string, onSale = true): AttentionVariant => ({
      wholesalerId: productId === '99' ? OTHER : W,
      productId,
      productName: `Mahsulot ${productId}`,
      variantId: String(Number(productId) + 800),
      sku: `SKU-${productId}`,
      onSale,
    });
    const variants = [
      v('42'),
      v('44'),
      v('45'),
      v('46', false),
      v('47'),
      v('48'),
      v('49'),
      v('50'),
      v('99'),
    ];

    /** E’lon qilib qabul qiladi: `lines` — mahsulot → [e’lon, kelgan, brak, muddat?]. */
    const receive = async (
      lines: Record<string, [number, number, number, string?]>,
      wholesalerId = W,
    ) => {
      const declared = await inbound.declare({
        wholesalerId,
        expectedAt: inDays(1),
        items: Object.entries(lines).map(([productId, [quantity]]) => ({
          productId,
          quantity,
        })),
        actorId: '61',
      });
      return inbound.receive({
        id: declared.id,
        items: declared.items.map((item) => {
          const [, got, bad, expiry] = lines[item.productId];
          return {
            itemId: item.id,
            receivedQty: got,
            defectiveQty: bad,
            cell: 'A-01',
            ...(expiry ? { expiryDate: expiry } : {}),
          };
        }),
        actorId: '61',
      });
    };

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
      const notifications = { emit: jest.fn(() => of(undefined)) };
      inbound = new InboundService(
        ds,
        catalog as never,
        notifications as never,
      );
      returns = new ReturnInspectionService(ds, catalog as never);
      attention = new WholesalerAttentionService(ds, inventory);
    });

    afterAll(async () => {
      if (ds?.isInitialized) {
        await ds.query('DROP SCHEMA IF EXISTS inventory CASCADE');
        await ds.destroy();
      }
      await lock?.end();
    });

    it('postavka farqi, qoldiq tugagan (band, muddat, umuman yo‘q), qaytarilmagan brak; aktlar — brak va qabul farqi', async () => {
      // 42: 10 e’lon, 10 keldi, 2 brak — farq
      const defect = await receive({ '42': [10, 10, 2] });
      // 44: 5 keldi, hammasi bandda; keyin 20 dona e’lon qilindi (yo‘lda)
      await receive({ '44': [5, 5, 0] });
      await inventory.reserveAvailable({
        orderRef: '7300',
        items: [{ variantId: '844', quantity: 5 }],
        idempotencyKey: 'r-7300',
      });
      const incoming = await inbound.declare({
        wholesalerId: W,
        expectedAt: inDays(3),
        items: [{ productId: '44', quantity: 20 }],
        actorId: '61',
      });
      // 45: muddatiga 50 kun — sotuvga chiqmaydi (OMB-3)
      await receive({ '45': [6, 6, 0, inDays(50)] });
      // 47: 3 keldi; buyurtma 7201 — 2 dona topshirildi, qaytdi: 1 sotiladi, 1 brak
      await receive({ '47': [3, 3, 0] });
      await inventory.reserveAvailable({
        orderRef: '7201',
        items: [{ variantId: '847', quantity: 2 }],
        idempotencyKey: 'r-7201',
      });
      await inventory.commit({ orderRef: '7201', idempotencyKey: 'c-7201' });
      await returns.grade({
        orderRef: '7201',
        items: [{ variantId: '847', sellable: 1, defective: 1 }],
        actorId: '61',
      });
      // 48 ortiq, 49 kam (jami teng) — farq akti
      const mixed = await receive({ '48': [10, 12, 0], '49': [10, 8, 0] });
      // boshqa optovik: brak
      await receive({ '99': [4, 4, 1] }, OTHER);

      const result = await attention.attention({ variants });

      // yangisi tepada; brak yo‘q, lekin qatorlarda farq bor postavka ham
      expect(
        result.defectShipments.map((r) => [
          r.wholesalerId,
          r.productName,
          r.declared,
          r.received,
          r.defect,
        ]),
      ).toEqual([
        [OTHER, 'Mahsulot 99', 4, 4, 1],
        [W, 'Mahsulot 48', 20, 20, 0],
        [W, 'Mahsulot 42', 10, 10, 2],
      ]);
      expect(result.defectShipments[2]).toMatchObject({
        shipmentId: defect.id,
        code: defect.number,
      });

      expect(
        [...result.outOfStock].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        ),
      ).toEqual([
        {
          productId: '44',
          onHand: 5,
          reserved: 5,
          incomingCode: incoming.number,
          incomingQty: 20,
        },
        // muddat sabab to‘silgan partiya — omborda 6, sotsa bo‘ladigani 0
        {
          productId: '45',
          onHand: 6,
          reserved: 0,
          incomingCode: null,
          incomingQty: 0,
        },
        // sotuvda, omborda umuman yo‘q
        {
          productId: '50',
          onHand: 0,
          reserved: 0,
          incomingCode: null,
          incomingQty: 0,
        },
      ]);

      expect(
        [...result.defectByWholesaler].sort((a, b) =>
          a.wholesalerId.localeCompare(b.wholesalerId),
        ),
      ).toEqual([
        {
          wholesalerId: W,
          quantity: 3,
          fromReceiving: 2,
          receivingCodes: [defect.number],
          fromReturns: 1,
          returnCodes: ['L-7201'],
        },
        {
          wholesalerId: OTHER,
          quantity: 1,
          fromReceiving: 1,
          receivingCodes: [expect.stringMatching(/^PS-\d{6}$/)],
          fromReturns: 0,
          returnCodes: [],
        },
      ]);

      const acts = await attention.acts({ wholesalerId: W, variants });
      expect(acts.map((a) => [a.kind, a.code, a.title])).toEqual([
        ['DEFECT', 'BA-007201', 'Mahsulot 47 · 1 dona · L-7201'],
        [
          'RECEIVING',
          mixed.number,
          'Mahsulot 48 va yana 1 · farq: 2 kam, 2 ortiq',
        ],
        ['RECEIVING', defect.number, 'Mahsulot 42 · farq: 2 brak'],
      ]);
      expect(acts.every((a) => a.at instanceof Date)).toBe(true);
      // boshqa optovikning aktlari chiqmaydi
      expect(
        (await attention.acts({ wholesalerId: OTHER, variants })).map(
          (a) => a.title,
        ),
      ).toEqual(['Mahsulot 99 · farq: 1 brak']);
    });
  },
);
