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
import { ParcelService } from './parcel.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/** BE-25 lid namunasidagi qabul qiluvchi (SOATO, EQ-06). */
function confirmed(
  overrides: Partial<OrderStatusChangedEvent> = {},
): OrderStatusChangedEvent {
  return {
    eventId: 'evt-confirm-1',
    orderId: '501',
    leadId: '9001',
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
        name: 'Simsiz quloqchin',
        quantity: 2,
        weightGrams: 350,
      },
    ],
    codAmount: 276000,
    occurredAt: '2026-11-17T10:00:00.000Z',
    ...overrides,
  };
}

describeWithPostgres('BE-20 Elchi posilka navbati (PostgreSQL)', () => {
  let ds: DataSource;
  let elchi: { createShipment: jest.Mock; cancelShipment: jest.Mock };
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
  const outboxTypes = async () =>
    (
      (await ds.query(
        `SELECT event_type FROM integration.outbox_event ORDER BY id`,
      )) as Array<{ event_type: string }>
    ).map((row) => row.event_type);

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
    await ds.query(`
      INSERT INTO integration.geo_cache (kind, elchi_id, name, elchi_region_id, sato_code) VALUES
        ('region', 14, 'Toshkent shahri', NULL, '1726'),
        ('district', 1401, 'Yunusobod', 14, '1726264'),
        ('region', 3, 'Samarqand', NULL, '1718'),
        ('district', 301, 'Urgut', 3, '1718236')`);
  });

  beforeEach(async () => {
    await ds.query(
      'TRUNCATE integration.parcel_request, integration.outbox_event, integration.processed_event',
    );
    marketId = '7001';
    elchi = {
      createShipment: jest.fn(async () => ({
        shipment_id: '1251131',
        qr_code_token: 'qr-abc',
        to_be_paid: 276000,
      })),
      cancelShipment: jest.fn(async () => undefined),
    };
    service = new ParcelService(
      ds,
      elchi as never,
      new OutboxService(ds.getRepository(OutboxEvent)),
      { get: () => marketId } as never,
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
    expect(await outboxTypes()).toEqual(['elchi.parcel.created']);
    const [event] = await ds.query(
      `SELECT payload FROM integration.outbox_event`,
    );
    expect(event.payload).toMatchObject({
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

    await ds.query(
      `UPDATE integration.parcel_request SET next_attempt_at = now()`,
    );
    await service.processDue();
    expect(await parcel()).toMatchObject({ status: 'PENDING', attempts: 2 });

    await ds.query(
      `UPDATE integration.parcel_request SET next_attempt_at = now()`,
    );
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
      external_order_id: '501',
      elchi_market_id: '7001',
      customer: { name: 'Dilnoza Karimova', phone: '+998901234567' },
      address: 'Navoiy ko‘chasi 12-uy',
      region_id: '14',
      district_id: '1401',
      where_deliver: 'address',
      items: [
        {
          name: 'Simsiz quloqchin',
          quantity: 2,
          external_product_id: '88',
          weight_kg: 0.35,
        },
      ],
      cod_amount: 276000,
    });
  });

  it('tuman topilmasa posilka yaratilmaydi: FAILED va elchi.parcel.failed', async () => {
    await service.onOrderStatusChanged(
      confirmed({
        recipient: { ...confirmed().recipient, districtSoato: '1726999' },
      }),
    );
    await service.processDue();

    expect(elchi.createShipment).not.toHaveBeenCalled();
    expect(await parcel()).toMatchObject({ status: 'FAILED' });
    expect(await outboxTypes()).toEqual(['elchi.parcel.failed']);
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

  it('Elchi so‘rovni rad etsa (400) qayta urinilmaydi', async () => {
    await service.onOrderStatusChanged(confirmed());
    elchi.createShipment.mockRejectedValueOnce(
      new ElchiApiError(400, 'district_id noto‘g‘ri'),
    );
    await service.processDue();
    expect(await parcel()).toMatchObject({ status: 'FAILED' });
    expect(await outboxTypes()).toEqual(['elchi.parcel.failed']);
  });

  it('platforma marketi sozlanmagan bo‘lsa navbatda kutadi', async () => {
    marketId = undefined;
    await service.onOrderStatusChanged(confirmed());
    await service.processDue();
    expect(elchi.createShipment).not.toHaveBeenCalled();
    expect(await parcel()).toMatchObject({ status: 'PENDING', waiting: true });
  });

  it('TC5: «Bekor qilindi» → Elchi posilkasi bekor; takroriy hodisa → ikkinchi so‘rov yo‘q', async () => {
    await service.onOrderStatusChanged(confirmed());
    await service.processDue();
    const cancelled = confirmed({
      eventId: 'evt-cancel-1',
      status: LeadOrderStatus.CANCELLED,
      previousStatus: LeadOrderStatus.CONFIRMED,
    });

    await service.onOrderStatusChanged(cancelled);
    await service.processDue();
    await service.onOrderStatusChanged(cancelled);
    await service.onOrderStatusChanged({
      ...cancelled,
      eventId: 'evt-cancel-2',
    });
    await service.processDue();

    expect(elchi.cancelShipment).toHaveBeenCalledTimes(1);
    expect(elchi.cancelShipment).toHaveBeenCalledWith('1251131');
    expect(await parcel()).toMatchObject({ status: 'CANCELLED' });
  });

  it('yaratilmagan posilka bekor qilinsa Elchi ga murojaat yo‘q; kechikkan «Tasdiqlandi» yaratmaydi', async () => {
    await service.onOrderStatusChanged(
      confirmed({ eventId: 'evt-cancel-0', status: LeadOrderStatus.CANCELLED }),
    );
    await service.onOrderStatusChanged(confirmed());
    await service.processDue();

    expect(elchi.createShipment).not.toHaveBeenCalled();
    expect(elchi.cancelShipment).not.toHaveBeenCalled();
    expect(await parcel()).toMatchObject({ status: 'CANCELLED' });
  });

  it('Elchi yetkazilgan posilkani bekor qilmasa (409) posilka CREATED qoladi', async () => {
    await service.onOrderStatusChanged(confirmed());
    await service.processDue();
    elchi.cancelShipment.mockRejectedValueOnce(new ElchiApiError(409, 'sold'));

    await service.onOrderStatusChanged(
      confirmed({ eventId: 'evt-cancel-1', status: LeadOrderStatus.CANCELLED }),
    );
    await service.processDue();

    expect(await parcel()).toMatchObject({
      status: 'CREATED',
      lastError: 'sold',
    });
  });

  it('to‘liq bo‘lmagan hodisa rad etiladi va belgi yozilmaydi', async () => {
    await expect(
      service.onOrderStatusChanged(
        confirmed({ recipient: { ...confirmed().recipient, phone: '' } }),
      ),
    ).rejects.toThrow('to‘liq emas');
    const [{ count }] = await ds.query(
      `SELECT count(*)::int AS count FROM integration.processed_event`,
    );
    expect(count).toBe(0);
  });
});
