import { Client } from 'pg';
import { DataSource } from 'typeorm';
import {
  CheckoutDeliveryDestination,
  LeadOrderStatus,
  OrderStatusChangedEvent,
  OutboxEvent,
  OutboxService,
} from '@app/common';
import { ElchiApiError } from './elchi-api.client';
import { CreateIntegrationTables1722900000000 } from './migrations/1722900000000-create-integration-tables';
import { AddGeoSatoCode1725285600000 } from './migrations/1725285600000-add-geo-sato-code';
import { AddProvisionTariffs1725375600000 } from './migrations/1725375600000-add-provision-tariffs';
import { CreateParcelQueue1795392000000 } from './migrations/1795392000000-create-parcel-queue';
import { ParcelService, elchiItemName } from './parcel.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/** BE-25 lid namunasidagi buyurtma (SOATO, EQ-06; 2.5-1 narx misoli). */
function confirmed(
  overrides: Partial<OrderStatusChangedEvent> = {},
): OrderStatusChangedEvent {
  return {
    eventId: 'evt-confirm-1',
    orderId: '501',
    orderNumber: 'L-1183',
    leadId: '9001',
    source: 'LANDING',
    streamId: '31',
    affiliateId: '12',
    wholesalerId: '4',
    status: LeadOrderStatus.CONFIRMED,
    previousStatus: null,
    recipient: {
      name: 'Dilnoza Karimova',
      phone: '+998901234567',
      regionSoato: '1726',
      districtSoato: '1726264',
      addressLine: 'Navoiy ko‘chasi 12-uy',
      whereDeliver: CheckoutDeliveryDestination.ADDRESS,
    },
    items: [
      {
        productId: '88',
        sku: 'EAR-01',
        name: 'Simsiz quloqchin',
        quantity: 1,
        weightGrams: 350,
        approvedPrice: 251000,
        basePrice: 140000,
        salePrice: 276000,
        split: { affiliateFee: 65000, callCenterFee: 12000, hiddenDelivery: 0 },
      },
    ],
    delivery: { mode: 'SEPARATE', cost: 25000 },
    codAmount: 276000,
    parcel: null,
    occurredAt: '2026-11-17T10:00:00.000Z',
    ...overrides,
  };
}

const cancelledEvent = (eventId: string) =>
  confirmed({
    eventId,
    status: LeadOrderStatus.CANCELLED,
    previousStatus: LeadOrderStatus.CONFIRMED,
  });

describeWithPostgres('BE-20 Elchi posilka navbati (PostgreSQL)', () => {
  let ds: DataSource;
  let elchi: { createShipment: jest.Mock; cancelShipment: jest.Mock };
  let geo: { syncGeoCache: jest.Mock };
  let outbox: OutboxService;
  let service: ParcelService;
  let marketId: string | undefined;
  /** Boshqa sozlamalar (BE-41: `ELCHI_FISCAL_RECEIPT`). */
  let settings: Record<string, string | undefined>;

  const parcel = async (orderId = '501') =>
    (
      await ds.query(
        `SELECT status, shipment_id AS "shipmentId", attempts,
                next_attempt_at > now() AS "waiting", last_error AS "lastError"
           FROM integration.parcel_request WHERE order_id=$1`,
        [orderId],
      )
    )[0];
  const outboxRows = async () =>
    (await ds.query(
      `SELECT event_type AS "type", payload FROM integration.outbox_event ORDER BY id`,
    )) as Array<{ type: string; payload: Record<string, unknown> }>;
  const outboxTypes = async () => (await outboxRows()).map((row) => row.type);
  const makeDue = () =>
    ds.query(`UPDATE integration.parcel_request SET next_attempt_at = now()`);

  beforeAll(async () => {
    const url = new URL(testDatabaseUrl!);
    if (!url.pathname.toLowerCase().includes('test')) {
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    }
    const admin = new Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query('DROP SCHEMA IF EXISTS integration CASCADE');
    await admin.query('CREATE SCHEMA integration');
    await admin.end();
    ds = await new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      schema: 'integration',
      entities: [OutboxEvent],
      migrations: [
        CreateIntegrationTables1722900000000,
        AddGeoSatoCode1725285600000,
        AddProvisionTariffs1725375600000,
        CreateParcelQueue1795392000000,
      ],
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
  });

  beforeEach(async () => {
    await ds.query(
      'TRUNCATE integration.parcel_request, integration.outbox_event, integration.processed_event, integration.geo_cache',
    );
    await ds.query(`
      INSERT INTO integration.geo_cache (kind, elchi_id, name, elchi_region_id, sato_code) VALUES
        ('region', 14, 'Toshkent shahri', NULL, '1726'),
        ('district', 1401, 'Yunusobod', 14, '1726264'),
        ('region', 3, 'Samarqand', NULL, '1718'),
        ('district', 301, 'Urgut', 3, '1718236')`);
    marketId = '7001';
    settings = {};
    elchi = {
      createShipment: jest.fn(async () => ({
        shipment_id: '1251131',
        qr_code_token: 'qr-abc',
        to_be_paid: 276000,
      })),
      cancelShipment: jest.fn(async () => undefined),
    };
    geo = { syncGeoCache: jest.fn(async () => ({})) };
    outbox = new OutboxService(ds.getRepository(OutboxEvent));
    service = new ParcelService(
      ds,
      elchi as never,
      outbox,
      {
        get: (key: string) =>
          key === 'ELCHI_PLATFORM_MARKET_ID' ? marketId : settings[key],
      } as never,
      geo as never,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS integration CASCADE');
      await ds.destroy();
    }
  });

  it('TC1: bir xil «Tasdiqlandi» 2 marta → bitta posilka, bitta elchi.parcel.created', async () => {
    await expect(service.onOrderStatusChanged(confirmed())).resolves.toEqual({
      duplicate: false,
    });
    await expect(service.onOrderStatusChanged(confirmed())).resolves.toEqual({
      duplicate: true,
    });
    // boshqa eventId, o'sha buyurtma — baribir bitta qator
    await service.onOrderStatusChanged(confirmed({ eventId: 'evt-confirm-2' }));

    await service.processDue();
    await service.processDue();

    expect(elchi.createShipment).toHaveBeenCalledTimes(1);
    expect(await parcel()).toMatchObject({
      status: 'CREATED',
      shipmentId: '1251131',
    });
    const rows = await outboxRows();
    expect(rows.map((row) => row.type)).toEqual(['elchi.parcel.created']);
    expect(rows[0].payload).toMatchObject({
      eventId: 'elchi.parcel.created:501',
      orderId: '501',
      shipmentId: '1251131',
      qrCodeToken: 'qr-abc',
      toBePaid: 276000,
    });
  });

  it('TC2: Elchi ishlamasa buyurtma navbatda kutadi, keyin yaratiladi', async () => {
    await service.onOrderStatusChanged(confirmed());
    elchi.createShipment.mockRejectedValueOnce(
      new ElchiApiError(503, 'Elchi API POST /partner/shipments → 503'),
    );
    elchi.createShipment.mockRejectedValueOnce(new Error('fetch failed'));

    await service.processDue();
    expect(await parcel()).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      waiting: true,
    });
    // vaqti kelmagan — Elchi ga qayta murojaat yo'q
    await service.processDue();
    expect(elchi.createShipment).toHaveBeenCalledTimes(1);

    await makeDue();
    await service.processDue();
    expect(await parcel()).toMatchObject({ status: 'PENDING', attempts: 2 });

    await makeDue();
    await service.processDue();
    expect(await parcel()).toMatchObject({
      status: 'CREATED',
      attempts: 3,
      lastError: null,
    });
    expect(await outboxTypes()).toEqual(['elchi.parcel.created']);
  });

  it('TC3, TC4: so‘rovda og‘irlik, qabul qiluvchi, Elchi viloyat/tuman ID si va manzil', async () => {
    await service.onOrderStatusChanged(confirmed());
    await service.processDue();

    expect(elchi.createShipment).toHaveBeenCalledWith({
      external_order_id: 'mp-order:501',
      elchi_market_id: '7001',
      customer: { name: 'Dilnoza Karimova', phone: '+998901234567' },
      address: 'Navoiy ko‘chasi 12-uy',
      region_id: '14',
      district_id: '1401',
      where_deliver: 'address',
      items: [
        {
          name: 'Simsiz quloqchin #88',
          quantity: 1,
          external_product_id: '88',
          weight_kg: 0.35,
        },
      ],
      cod_amount: 276000,
    });
  });

  it('tuman topilmasa geo kesh bir marta yangilanadi; baribir yo‘q bo‘lsa FAILED va elchi.parcel.failed', async () => {
    await service.onOrderStatusChanged(
      confirmed({
        recipient: { ...confirmed().recipient, districtSoato: '1726999' },
      }),
    );
    await service.processDue();

    expect(geo.syncGeoCache).toHaveBeenCalledTimes(1);
    expect(elchi.createShipment).not.toHaveBeenCalled();
    expect(await parcel()).toMatchObject({ status: 'FAILED' });
    expect(await outboxTypes()).toEqual(['elchi.parcel.failed']);
  });

  it('bo‘sh geo kesh yangilangach posilka yaratiladi', async () => {
    await ds.query('TRUNCATE integration.geo_cache');
    geo.syncGeoCache.mockImplementationOnce(async () => {
      await ds.query(`
        INSERT INTO integration.geo_cache (kind, elchi_id, name, elchi_region_id, sato_code) VALUES
          ('region', 14, 'Toshkent shahri', NULL, '1726'),
          ('district', 1401, 'Yunusobod', 14, '1726264')`);
    });
    await service.onOrderStatusChanged(confirmed());
    await service.processDue();
    expect(await parcel()).toMatchObject({ status: 'CREATED' });
  });

  it('tuman boshqa viloyatniki bo‘lsa — FAILED', async () => {
    await service.onOrderStatusChanged(
      confirmed({
        recipient: { ...confirmed().recipient, districtSoato: '1718236' },
      }),
    );
    await service.processDue();
    expect(elchi.createShipment).not.toHaveBeenCalled();
    expect(await parcel()).toMatchObject({ status: 'FAILED' });
  });

  it('Elchi so‘rovni rad etsa (400) FAILED; sozlama xatosi (403) esa qayta uriniladi', async () => {
    await service.onOrderStatusChanged(confirmed());
    await service.onOrderStatusChanged(
      confirmed({ eventId: 'evt-502', orderId: '502' }),
    );
    elchi.createShipment
      .mockRejectedValueOnce(new ElchiApiError(400, 'district_id noto‘g‘ri'))
      .mockRejectedValueOnce(
        new ElchiApiError(403, 'market partnerga tegishli emas'),
      );
    await service.processDue();

    expect(await parcel('501')).toMatchObject({ status: 'FAILED' });
    expect(await parcel('502')).toMatchObject({
      status: 'PENDING',
      waiting: true,
    });
    expect(await outboxTypes()).toEqual(['elchi.parcel.failed']);
  });

  it('FAILED buyurtma yangi «Tasdiqlandi» bilan qayta navbatga tushadi', async () => {
    await service.onOrderStatusChanged(confirmed());
    elchi.createShipment.mockRejectedValueOnce(new ElchiApiError(422, 'xato'));
    await service.processDue();
    expect(await parcel()).toMatchObject({ status: 'FAILED' });

    await service.onOrderStatusChanged(confirmed({ eventId: 'evt-confirm-2' }));
    await service.processDue();
    expect(await parcel()).toMatchObject({ status: 'CREATED' });
  });

  describe('BE-41: fiskal chek ma’lumoti (chekni Elchi kuryeri chiqaradi)', () => {
    const fiscal = (mxikCode: string, wholesalerTin = '305123456') => ({
      mxikCode,
      packageCode: '1500012',
      wholesalerTin,
    });
    /** Qisman rejim: 2 × 276 000 + ikkinchi tovar 120 000 + ko‘rinadigan yetkazish 30 000 = 702 000. */
    const receiptOrder = (over: Partial<OrderStatusChangedEvent> = {}) =>
      confirmed({
        items: [
          {
            productId: '88',
            wholesalerId: '4',
            sku: 'EAR-01',
            name: 'Simsiz quloqchin',
            quantity: 2,
            weightGrams: 350,
            approvedPrice: 251000,
            basePrice: 140000,
            salePrice: 276000,
            split: {
              affiliateFee: 130000,
              callCenterFee: 24000,
              hiddenDelivery: 22000,
            },
            fiscal: fiscal('08517001001000000'),
          },
          {
            productId: '91',
            wholesalerId: '6',
            sku: 'CAS-01',
            name: 'G‘ilof',
            quantity: 1,
            weightGrams: 100,
            approvedPrice: 110000,
            basePrice: 60000,
            salePrice: 120000,
            split: {
              affiliateFee: 30000,
              callCenterFee: 12000,
              hiddenDelivery: 11000,
            },
            fiscal: fiscal('03926001001000000', '207654321'),
          },
        ],
        delivery: { mode: 'PARTIAL', cost: 30000 },
        codAmount: 702000,
        ...over,
      });
    const sentBody = () =>
      elchi.createShipment.mock.calls[0][0] as Record<string, any>;

    it('TC2: sozlama yoqilgan — har qatorda narx, MXIK, qadoq kodi, komitent STIR i; yetkazish alohida; jami = COD (TC3)', async () => {
      settings.ELCHI_FISCAL_RECEIPT = 'on';
      await service.onOrderStatusChanged(receiptOrder());
      await service.processDue();

      const body = sentBody();
      expect(body.items).toEqual([
        {
          name: 'Simsiz quloqchin #88',
          quantity: 2,
          external_product_id: '88',
          weight_kg: 0.35,
          price: 276000,
          fiscal: {
            name: 'Simsiz quloqchin',
            mxik_code: '08517001001000000',
            package_code: '1500012',
            commitent_tin: '305123456',
            commission: true,
          },
        },
        {
          name: 'G‘ilof #91',
          quantity: 1,
          external_product_id: '91',
          weight_kg: 0.1,
          price: 120000,
          fiscal: {
            name: 'G‘ilof',
            mxik_code: '03926001001000000',
            package_code: '1500012',
            commitent_tin: '207654321',
            commission: true,
          },
        },
      ]);
      expect(body.delivery_price).toBe(30000);
      // TC3: chek jami = sotuvchi sahifasidagi jami (tovar + ko‘rinadigan yetkazish) = kuryer oladigan summa
      const receiptTotal =
        body.items.reduce(
          (sum: number, item: { price: number; quantity: number }) =>
            sum + item.price * item.quantity,
          0,
        ) + body.delivery_price;
      expect(receiptTotal).toBe(body.cod_amount);
      expect(body.cod_amount).toBe(702000);
      expect(await parcel()).toMatchObject({ status: 'CREATED' });
    });

    it('sozlama o‘chiq (sukut) — so‘rov bugungidek: Elchi noma’lum maydonni 400 bilan rad etadi', async () => {
      await service.onOrderStatusChanged(receiptOrder());
      await service.processDue();

      const body = sentBody();
      expect(body).not.toHaveProperty('delivery_price');
      for (const item of body.items) {
        expect(item).not.toHaveProperty('price');
        expect(item).not.toHaveProperty('fiscal');
      }
    });

    it('kod yoki STIR yo‘q (BE-41 dan oldingi mahsulot) — posilka chek maydonlarisiz yaratiladi, to‘xtamaydi', async () => {
      settings.ELCHI_FISCAL_RECEIPT = 'on';
      const order = receiptOrder();
      order.items[1].fiscal = {
        mxikCode: null,
        packageCode: '1500012',
        wholesalerTin: '207654321',
      };
      await service.onOrderStatusChanged(order);
      await service.processDue();

      const body = sentBody();
      expect(body).not.toHaveProperty('delivery_price');
      expect(body.items[0]).not.toHaveProperty('fiscal');
      expect(await parcel()).toMatchObject({ status: 'CREATED' });
    });

    it('Elchi chek maydonlarini rad etsa (400) — bir marta chek maydonlarisiz qayta yuboriladi, posilka yaratiladi', async () => {
      settings.ELCHI_FISCAL_RECEIPT = 'on';
      elchi.createShipment.mockRejectedValueOnce(
        new ElchiApiError(400, 'property items.0.fiscal should not exist'),
      );
      await service.onOrderStatusChanged(receiptOrder());
      await service.processDue();

      expect(elchi.createShipment).toHaveBeenCalledTimes(2);
      const [first, second] = elchi.createShipment.mock.calls.map(
        (c) => c[0] as Record<string, any>,
      );
      expect(first.delivery_price).toBe(30000);
      expect(second).not.toHaveProperty('delivery_price');
      expect(second.items[0]).not.toHaveProperty('fiscal');
      expect(second.items[0]).not.toHaveProperty('price');
      expect(second.items[0]).toMatchObject({
        name: 'Simsiz quloqchin #88',
        quantity: 2,
      });
      expect(second.external_order_id).toBe(first.external_order_id);
      expect(await parcel()).toMatchObject({ status: 'CREATED' });

      // qayta yuborilgan so‘rov — sozlama o‘chiq bo‘lgandagi so‘rovning aynan o‘zi
      await ds.query(
        'TRUNCATE integration.parcel_request, integration.processed_event',
      );
      elchi.createShipment.mockClear();
      delete settings.ELCHI_FISCAL_RECEIPT;
      await service.onOrderStatusChanged(receiptOrder());
      await service.processDue();
      expect(elchi.createShipment.mock.calls[0][0]).toEqual(second);
    });

    it('Elchi rad etguncha buyurtma bekor qilingan bo‘lsa — qayta yuborilmaydi', async () => {
      settings.ELCHI_FISCAL_RECEIPT = 'on';
      elchi.createShipment.mockImplementationOnce(async () => {
        // birinchi so‘rov yo‘lda — shu orada «Bekor qilindi» keladi
        await ds.query(
          `UPDATE integration.parcel_request SET status = 'CANCEL_PENDING' WHERE order_id = '501'`,
        );
        throw new ElchiApiError(400, 'fiscal');
      });
      await service.onOrderStatusChanged(receiptOrder());
      await service.processDue();
      expect(elchi.createShipment).toHaveBeenCalledTimes(1);
    });

    it('chek maydonlarisiz so‘rov ham rad etilsa — bugungidek FAILED (uchinchi urinish yo‘q)', async () => {
      settings.ELCHI_FISCAL_RECEIPT = 'on';
      elchi.createShipment
        .mockRejectedValueOnce(new ElchiApiError(400, 'fiscal'))
        .mockRejectedValueOnce(new ElchiApiError(422, 'district'));
      await service.onOrderStatusChanged(receiptOrder());
      await service.processDue();

      expect(elchi.createShipment).toHaveBeenCalledTimes(2);
      expect(await parcel()).toMatchObject({ status: 'FAILED' });
    });

    it('jami COD ga teng emas — chek maydonlarisiz (noto‘g‘ri chek chiqmaydi)', async () => {
      settings.ELCHI_FISCAL_RECEIPT = 'on';
      await service.onOrderStatusChanged(receiptOrder({ codAmount: 700000 }));
      await service.processDue();

      expect(sentBody().items[0]).not.toHaveProperty('price');
      expect(await parcel()).toMatchObject({ status: 'CREATED' });
    });
  });

  it('platforma marketi sozlanmagan bo‘lsa navbatda kutadi', async () => {
    marketId = undefined;
    await service.onOrderStatusChanged(confirmed());
    await service.processDue();
    expect(elchi.createShipment).not.toHaveBeenCalled();
    expect(await parcel()).toMatchObject({ status: 'PENDING', waiting: true });
  });

  it('kutilmagan xato navbatni to‘smaydi: qator keyinga suriladi, keyingisi ishlanadi', async () => {
    await service.onOrderStatusChanged(confirmed());
    await service.onOrderStatusChanged(
      confirmed({ eventId: 'evt-502', orderId: '502' }),
    );
    const record = jest.spyOn(outbox, 'record');
    record.mockRejectedValueOnce(new Error('outbox yozilmadi'));

    await service.processDue();

    expect(await parcel('501')).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      waiting: true,
      lastError: 'outbox yozilmadi',
    });
    expect(await parcel('502')).toMatchObject({ status: 'CREATED' });
  });

  it('TC5: «Bekor qilindi» → Elchi posilkasi bekor; takroriy hodisa → ikkinchi so‘rov yo‘q', async () => {
    await service.onOrderStatusChanged(confirmed());
    await service.processDue();

    await service.onOrderStatusChanged(cancelledEvent('evt-cancel-1'));
    await service.processDue();
    await service.onOrderStatusChanged(cancelledEvent('evt-cancel-1'));
    await service.onOrderStatusChanged(cancelledEvent('evt-cancel-2'));
    await service.processDue();

    expect(elchi.cancelShipment).toHaveBeenCalledTimes(1);
    expect(elchi.cancelShipment).toHaveBeenCalledWith('1251131');
    expect(await parcel()).toMatchObject({ status: 'CANCELLED' });
    expect(await outboxTypes()).toEqual([
      'elchi.parcel.created',
      'elchi.parcel.cancelled',
    ]);
  });

  it('Elchi ga yuborilmagan posilka bekor qilinsa murojaat yo‘q; kechikkan «Tasdiqlandi» yaratmaydi', async () => {
    await service.onOrderStatusChanged(cancelledEvent('evt-cancel-0'));
    await service.onOrderStatusChanged(confirmed());
    await service.processDue();

    expect(elchi.createShipment).not.toHaveBeenCalled();
    expect(elchi.cancelShipment).not.toHaveBeenCalled();
    expect(await parcel()).toMatchObject({ status: 'CANCELLED' });
  });

  it('javobi kelmagan yaratishdan keyin bekor qilish: 404 → takroriy yaratish ID beradi → ID bo‘yicha bekor', async () => {
    await service.onOrderStatusChanged(confirmed());
    elchi.createShipment.mockRejectedValueOnce(
      new Error('The operation was aborted due to timeout'),
    );
    await service.processDue();
    await service.onOrderStatusChanged(cancelledEvent('evt-cancel-1'));
    expect(await parcel()).toMatchObject({ status: 'CANCEL_PENDING' });

    // Elchi bog'lovchi yozuvsiz buyurtmani tashqi id bo'yicha topmaydi
    elchi.cancelShipment.mockRejectedValueOnce(
      new ElchiApiError(404, 'Shipment topilmadi'),
    );
    await service.processDue();

    expect(elchi.cancelShipment.mock.calls).toEqual([
      ['mp-order:501'],
      ['1251131'],
    ]);
    expect(elchi.createShipment).toHaveBeenCalledTimes(2);
    expect(await parcel()).toMatchObject({
      status: 'CANCELLED',
      shipmentId: '1251131',
    });
    // posilka bekor qilingan buyurtma uchun «yaratildi» hodisasi ketmaydi
    expect(await outboxTypes()).toEqual(['elchi.parcel.cancelled']);
  });

  it('404 va takroriy yaratishni Elchi rad etsa (400) — buyurtma Elchi da yo‘q, CANCELLED', async () => {
    await service.onOrderStatusChanged(confirmed());
    elchi.createShipment
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new ElchiApiError(400, 'district_id noto‘g‘ri'));
    await service.processDue();
    await service.onOrderStatusChanged(cancelledEvent('evt-cancel-1'));
    elchi.cancelShipment.mockRejectedValueOnce(
      new ElchiApiError(404, 'topilmadi'),
    );
    await service.processDue();
    expect(await parcel()).toMatchObject({ status: 'CANCELLED' });
    expect(await outboxTypes()).toEqual([]);
  });

  it('Elchi yetkazilgan posilkani bekor qilmasa (409) posilka CREATED qoladi va cancel-failed ketadi', async () => {
    await service.onOrderStatusChanged(confirmed());
    await service.processDue();
    elchi.cancelShipment.mockRejectedValueOnce(new ElchiApiError(409, 'sold'));

    await service.onOrderStatusChanged(cancelledEvent('evt-cancel-1'));
    await service.processDue();

    expect(await parcel()).toMatchObject({
      status: 'CREATED',
      lastError: 'sold',
    });
    expect(await outboxTypes()).toEqual([
      'elchi.parcel.created',
      'elchi.parcel.cancel-failed',
    ]);
  });

  it('to‘liq bo‘lmagan «Tasdiqlandi» → FAILED va elchi.parcel.failed (INVALID_EVENT), yo‘qolmaydi', async () => {
    await service.onOrderStatusChanged(
      confirmed({ recipient: { ...confirmed().recipient, phone: '' } }),
    );
    await service.onOrderStatusChanged(
      confirmed({
        eventId: 'evt-503',
        orderId: '503',
        items: [{ ...confirmed().items[0], weightGrams: 1.5 }],
      }),
    );
    await service.processDue();

    expect(elchi.createShipment).not.toHaveBeenCalled();
    expect(await parcel('501')).toMatchObject({ status: 'FAILED' });
    expect(await parcel('503')).toMatchObject({ status: 'FAILED' });
    const rows = await outboxRows();
    expect(rows.map((row) => row.payload.reason)).toEqual([
      'INVALID_EVENT',
      'INVALID_EVENT',
    ]);
  });

  it('yuborilmagan PENDING darhol bekor qilinadi — Elchi ga murojaat yo‘q', async () => {
    await service.onOrderStatusChanged(confirmed());
    await service.onOrderStatusChanged(cancelledEvent('evt-cancel-1'));
    await service.processDue();
    expect(await parcel()).toMatchObject({ status: 'CANCELLED' });
    expect(elchi.createShipment).not.toHaveBeenCalled();
    expect(elchi.cancelShipment).not.toHaveBeenCalled();
  });

  it('«yuborildi» belgisi Elchi chaqiruvidan oldin commit qilinadi (rollback uni o‘chira olmaydi)', async () => {
    await service.onOrderStatusChanged(confirmed());
    let seenFromOtherConnection: unknown;
    elchi.createShipment.mockImplementationOnce(async () => {
      [seenFromOtherConnection] = await ds.query(
        `SELECT last_create_at IS NOT NULL AS sent FROM integration.parcel_request`,
      );
      throw new Error('jarayon o‘ldi');
    });
    await service.processDue();
    expect(seenFromOtherConnection).toEqual({ sent: true });
    // keyingi «Bekor qilindi» Elchi orqali boradi
    await service.onOrderStatusChanged(cancelledEvent('evt-cancel-1'));
    expect(await parcel()).toMatchObject({ status: 'CANCEL_PENDING' });
  });

  it('yaratish ketayotganda «Bekor qilindi» keldi: posilka ID si yoziladi va bekor qilinadi', async () => {
    await service.onOrderStatusChanged(confirmed());
    elchi.createShipment.mockImplementationOnce(async () => {
      // qator band (lease), lekin qulflanmagan — hodisa kutmaydi
      await service.onOrderStatusChanged(cancelledEvent('evt-cancel-1'));
      return {
        shipment_id: '1251131',
        qr_code_token: 'qr-abc',
        to_be_paid: 276000,
      };
    });
    await service.processDue();

    expect(elchi.cancelShipment).toHaveBeenCalledWith('1251131');
    expect(await parcel()).toMatchObject({
      status: 'CANCELLED',
      shipmentId: '1251131',
    });
    expect(await outboxTypes()).toEqual(['elchi.parcel.cancelled']);
  });

  it('Elchi javobida QR kodi bo‘lmasa CREATED yozilmaydi; keyingi urinishda olinadi', async () => {
    await service.onOrderStatusChanged(confirmed());
    elchi.createShipment.mockResolvedValueOnce({ shipment_id: '1251131' });
    await service.processDue();
    expect(await parcel()).toMatchObject({
      status: 'PENDING',
      shipmentId: '1251131',
      waiting: true,
    });
    expect(await outboxTypes()).toEqual([]);

    await makeDue();
    await service.processDue();
    expect(await parcel()).toMatchObject({ status: 'CREATED' });
    expect(await outboxTypes()).toEqual(['elchi.parcel.created']);
  });

  it('har xato yangi «Tasdiqlandi» dan keyin yangi elchi.parcel.failed eventId oladi', async () => {
    await service.onOrderStatusChanged(confirmed());
    elchi.createShipment.mockRejectedValue(new ElchiApiError(422, 'xato'));
    await service.processDue();
    await service.onOrderStatusChanged(confirmed({ eventId: 'evt-confirm-2' }));
    await service.processDue();

    const ids = (await outboxRows()).map((row) => row.payload.eventId);
    expect(ids).toEqual([
      'elchi.parcel.failed:501:evt-confirm-1',
      'elchi.parcel.failed:501:evt-confirm-2',
    ]);
  });

  it('FAILED buyurtmaga yangi noto‘g‘ri tasdiq ham xabar beradi', async () => {
    const bad = (eventId: string) =>
      confirmed({
        eventId,
        recipient: { ...confirmed().recipient, phone: '' },
      });
    await service.onOrderStatusChanged(bad('evt-bad-1'));
    await service.onOrderStatusChanged(bad('evt-bad-2'));
    const ids = (await outboxRows()).map((row) => row.payload.eventId);
    expect(ids).toEqual([
      'elchi.parcel.failed:501:evt-bad-1',
      'elchi.parcel.failed:501:evt-bad-2',
    ]);
  });

  it('409 ORDER_INTAKE_CLOSED → reopens_at gacha kutadi; boshqa 409 → FAILED', async () => {
    const reopens = new Date(Date.now() + 6 * 3600_000).toISOString();
    await service.onOrderStatusChanged(confirmed());
    await service.onOrderStatusChanged(
      confirmed({ eventId: 'evt-502', orderId: '502' }),
    );
    elchi.createShipment
      .mockRejectedValueOnce(
        new ElchiApiError(409, 'intake closed', {
          statusCode: 409,
          code: 'ORDER_INTAKE_CLOSED',
          reopens_at: reopens,
        }),
      )
      .mockRejectedValueOnce(new ElchiApiError(409, 'label_token band', {}));
    await service.processDue();

    const [row] = await ds.query(
      `SELECT status, next_attempt_at >= $1::timestamptz AS "untilReopen"
         FROM integration.parcel_request WHERE order_id='501'`,
      [reopens],
    );
    expect(row).toEqual({ status: 'PENDING', untilReopen: true });
    expect(await parcel('502')).toMatchObject({ status: 'FAILED' });
  });

  it('geo kesh yangilanmasa tuman yo‘qligiga ishonilmaydi — navbatda kutadi', async () => {
    await ds.query('TRUNCATE integration.geo_cache');
    geo.syncGeoCache.mockRejectedValueOnce(new Error('Elchi geo ishlamayapti'));
    await service.onOrderStatusChanged(confirmed());
    await service.processDue();
    expect(await parcel()).toMatchObject({
      status: 'PENDING',
      waiting: true,
      lastError: 'Geo kesh yangilanmadi',
    });
    expect(await outboxTypes()).toEqual([]);
  });

  it('qabul yopiq birinchi so‘rovdan keyin tunda bekor qilish — Elchi ga murojaat yo‘q', async () => {
    await service.onOrderStatusChanged(confirmed());
    elchi.createShipment.mockRejectedValueOnce(
      new ElchiApiError(409, 'intake closed', {
        code: 'ORDER_INTAKE_CLOSED',
        reopens_at: new Date(Date.now() + 8 * 3600_000).toISOString(),
      }),
    );
    await service.processDue();
    await service.onOrderStatusChanged(cancelledEvent('evt-cancel-1'));
    await service.processDue();

    expect(await parcel()).toMatchObject({ status: 'CANCELLED' });
    expect(elchi.cancelShipment).not.toHaveBeenCalled();
    expect(elchi.createShipment).toHaveBeenCalledTimes(1);
  });

  it('tiklashda Elchi 409 (qabul yopiq emas) bilan rad etsa — CANCELLED, cheksiz takror yo‘q', async () => {
    await service.onOrderStatusChanged(confirmed());
    elchi.createShipment
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new ElchiApiError(409, 'customer conflict', {}));
    await service.processDue();
    await service.onOrderStatusChanged(cancelledEvent('evt-cancel-1'));
    elchi.cancelShipment.mockRejectedValueOnce(
      new ElchiApiError(404, 'topilmadi'),
    );
    await service.processDue();
    expect(await parcel()).toMatchObject({ status: 'CANCELLED' });
  });
  it('olingan, lekin hali yuborilmagan qator shu orada bekor qilinsa Elchi ga so‘rov ketmaydi', async () => {
    await ds.query('TRUNCATE integration.geo_cache');
    await service.onOrderStatusChanged(confirmed());
    // tuman topilmagach geo kesh yangilanadi — shu payt «Bekor qilindi» keladi
    geo.syncGeoCache.mockImplementationOnce(async () => {
      await service.onOrderStatusChanged(cancelledEvent('evt-cancel-race'));
      await ds.query(`
        INSERT INTO integration.geo_cache (kind, elchi_id, name, elchi_region_id, sato_code) VALUES
          ('region', 14, 'Toshkent shahri', NULL, '1726'),
          ('district', 1401, 'Yunusobod', 14, '1726264')`);
    });
    await service.processDue();

    expect(elchi.createShipment).not.toHaveBeenCalled();
    expect(await parcel()).toMatchObject({ status: 'CANCELLED' });
    expect(await outboxTypes()).toEqual([]);
  });

  it('yaratish paytida bekor qilingan qator uchun Elchi rad etsa elchi.parcel.failed yozilmaydi', async () => {
    await service.onOrderStatusChanged(confirmed());
    elchi.createShipment.mockImplementationOnce(async () => {
      await service.onOrderStatusChanged(cancelledEvent('evt-cancel-1'));
      throw new ElchiApiError(422, 'xato');
    });
    elchi.cancelShipment.mockRejectedValueOnce(
      new ElchiApiError(404, 'topilmadi'),
    );
    elchi.createShipment.mockRejectedValueOnce(new ElchiApiError(422, 'xato'));
    await service.processDue();

    expect(await parcel()).toMatchObject({ status: 'CANCELLED' });
    expect(await outboxTypes()).toEqual([]);
  });
});

describe('elchiItemName (BE-20)', () => {
  it('ID qo‘shimchasi bilan nom 255 belgidan oshmaydi', () => {
    const name = elchiItemName('x'.repeat(300), '12345');
    expect(name).toHaveLength(255);
    expect(name.endsWith(' #12345')).toBe(true);
    expect(elchiItemName(' Quloqchin ', '88')).toBe('Quloqchin #88');
  });
});
