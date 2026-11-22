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
import { ElchiApiError1797638400000 } from './migrations/1797638400000-elchi-api-error';
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
        ElchiApiError1797638400000,
      ],
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
  });

  beforeEach(async () => {
    await ds.query(
      'TRUNCATE integration.parcel_request, integration.outbox_event, integration.processed_event, integration.geo_cache, integration.elchi_api_error',
    );
    await ds.query(`
      INSERT INTO integration.geo_cache (kind, elchi_id, name, elchi_region_id, sato_code) VALUES
        ('region', 14, 'Toshkent shahri', NULL, '1726'),
        ('district', 1401, 'Yunusobod', 14, '1726264'),
        ('region', 3, 'Samarqand', NULL, '1718'),
        ('district', 301, 'Urgut', 3, '1718236')`);
    marketId = '7001';
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
      { get: () => marketId } as never,
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

  it('BE-26: Elchi xatolari jurnalga (monitor 5 daqiqada sanaydi); «qabul yopiq» va bekorda 404 — xato emas', async () => {
    elchi.createShipment
      .mockRejectedValueOnce(new ElchiApiError(503, 'Elchi ishlamayapti'))
      .mockRejectedValueOnce(new Error('fetch failed'));
    await service.onOrderStatusChanged(confirmed());
    await service.processDue();
    await makeDue();
    await service.processDue();
    await expect(service.apiErrorsSince(5)).resolves.toBe(2);
    const rows = (await ds.query(
      `SELECT operation, status FROM integration.elchi_api_error ORDER BY id`,
    )) as Array<{ operation: string; status: number | null }>;
    expect(rows).toEqual([
      { operation: 'shipment.create', status: 503 },
      { operation: 'shipment.create', status: null },
    ]);
    // 6 daqiqa oldingi xato hisobga kirmaydi
    await ds.query(
      `UPDATE integration.elchi_api_error SET at = now() - interval '6 minutes'`,
    );
    await expect(service.apiErrorsSince(5)).resolves.toBe(0);
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
