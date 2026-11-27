import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  InboundShipmentStatus,
  LeadOrderStatus,
  OrderStatusChangedEvent,
} from '@app/common';
import { NotificationChannel } from './entities/notification-delivery.entity';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { Notification } from './entities/notification.entity';
import { Broadcast } from './entities/broadcast.entity';
import { NOTIFICATION_DB } from './database';
import { NotificationService } from './notification.service';
import { OrderSmsController } from './order-sms.controller';
import { CabinetMessagesController } from './cabinet-messages.controller';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
/** order-sms.integration.spec bilan bir xil — notification sxemasini DROP/CREATE qiladi. */
const NOTIFICATION_SCHEMA_TEST_LOCK = 2_304_024;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/** BE-47 (TZ 6.12): kabinet xabarlari ro‘yxati — haqiqiy PostgreSQL. */
describeWithPostgres('BE-47 kabinet xabarlari (PostgreSQL)', () => {
  let ds: DataSource;
  let schemaLock: Client;
  let notifications: NotificationService;
  let sms: {
    channel: NotificationChannel;
    isConfigured: () => boolean;
    send: jest.Mock;
  };
  let orders: OrderSmsController;
  let cabinet: CabinetMessagesController;
  const shops: Record<string, Record<string, unknown>> = {
    '15': {
      id: '15',
      name: 'Gadget Trade',
      phone: '+998901110015',
      ownerUserId: '501',
    },
    '16': {
      id: '16',
      name: 'Termos Savdo',
      phone: '+998901110016',
      ownerUserId: null,
    },
  };

  const orderEvent = (
    status: LeadOrderStatus,
    over: Partial<OrderStatusChangedEvent> = {},
  ) =>
    ({
      eventId: `e-${status}`,
      orderId: '1284',
      orderNumber: 'L-1284',
      source: 'LANDING',
      affiliateId: '77',
      status,
      recipient: {
        name: 'Dilnoza',
        phone: '+998901234567',
        addressLine: 'Chilonzor 5-mavze, 12-uy',
        whereDeliver: 'CENTER',
        regionSoato: '1730',
        districtSoato: '1730401',
      },
      items: [
        {
          name: 'Simsiz quloqchin',
          quantity: 1,
          salePrice: 262000,
          split: {
            affiliateFee: 65000,
            callCenterFee: 10000,
            hiddenDelivery: 11000,
          },
        },
      ],
      delivery: { mode: 'PARTIAL', cost: 30000 },
      codAmount: 292000,
      parcel: null,
      ...over,
    }) as unknown as OrderStatusChangedEvent;
  const rowsOf = (userId: string) =>
    ds.query(
      `SELECT type, title, body FROM notification.notification WHERE user_id = $1 ORDER BY id`,
      [userId],
    ) as Promise<Array<{ type: string; title: string; body: string }>>;

  beforeAll(async () => {
    if (!new URL(testDatabaseUrl!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    schemaLock = new Client({ connectionString: testDatabaseUrl });
    await schemaLock.connect();
    await schemaLock.query('SELECT pg_advisory_lock($1)', [
      NOTIFICATION_SCHEMA_TEST_LOCK,
    ]);
    const admin = new Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query('DROP SCHEMA IF EXISTS notification CASCADE');
    await admin.query('CREATE SCHEMA notification');
    await admin.end();
    ds = await new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      schema: 'notification',
      entities: [
        Notification,
        NotificationDelivery,
        NotificationTemplate,
        Broadcast,
      ],
      migrations: NOTIFICATION_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
  }, 120_000);

  beforeEach(async () => {
    await ds.query(
      'TRUNCATE notification.notification_delivery, notification.notification CASCADE',
    );
    sms = {
      channel: NotificationChannel.SMS,
      isConfigured: () => true,
      send: jest.fn(async () => undefined),
    };
    notifications = new NotificationService(
      ds.getRepository(Notification),
      ds.getRepository(NotificationDelivery),
      [sms as never],
    );
    orders = new OrderSmsController(
      notifications,
      {} as never,
      { send: () => of({ ok: true, districtName: 'Qo‘qon shahri' }) } as never,
      { send: () => of({ id: '42', phone: '+998907776655' }) } as never,
    );
    cabinet = new CabinetMessagesController(
      notifications,
      {
        send: (pattern: { cmd: string }, data: Record<string, unknown>) =>
          pattern.cmd === 'catalog.shop.get-by-id'
            ? of(shops[String(data.shopId)])
            : of([
                {
                  productId: '42',
                  productName: 'Simsiz quloqchin',
                  variantId: '901',
                  sku: 'Q-1',
                  barcode: null,
                  wholesalerId: '15',
                  isBad: false,
                },
              ]),
      } as never,
      {
        send: (_p: unknown, data: { role: string }) =>
          of(data.role === 'ADMIN' ? [{ id: '1' }] : [{ id: '2' }]),
      } as never,
      { send: () => of(['77', '78']) } as never,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS notification CASCADE');
      await ds.destroy();
    }
    await schemaLock.query('SELECT pg_advisory_unlock($1)', [
      NOTIFICATION_SCHEMA_TEST_LOCK,
    ]);
    await schemaLock.end();
  });

  it('TC1/TC6: sotuvchi A ning buyurtmasi — yangi sotuv va yetkazildi A da, B da yo‘q; mijoz raqami va manzili yo‘q; takror hodisa — bitta xabar', async () => {
    await orders.onOrderStatus(orderEvent(LeadOrderStatus.CONFIRMED));
    await orders.onOrderStatus(orderEvent(LeadOrderStatus.CONFIRMED)); // takror
    await orders.onOrderStatus(orderEvent(LeadOrderStatus.PICKING)); // xabar yo‘q
    await orders.onOrderStatus(orderEvent(LeadOrderStatus.DELIVERED));
    await orders.onOrderStatus(
      orderEvent(LeadOrderStatus.REFUSED, {
        orderId: '1285',
        orderNumber: 'L-1285',
      }),
    );
    const mine = await rowsOf('77');
    expect(mine.map((row) => row.title)).toEqual([
      'Yangi sotuv',
      'Yetkazildi',
      'Rad etildi',
    ]);
    expect(mine[0].body).toBe(
      'L-1284 · Simsiz quloqchin ×1. Sotuvchi haqi: 65 000 so‘m',
    );
    // rad etilganda haq yo‘q
    expect(mine[2].body).toBe('L-1285 · Simsiz quloqchin ×1');
    for (const row of mine)
      expect(row.body).not.toMatch(/\+998|Chilonzor|Dilnoza/);
    expect(await rowsOf('78')).toEqual([]);
    // B o‘z ro‘yxatida A ning xabarini ko‘rmaydi
    await expect(
      notifications.findAll('78', {} as never),
    ).resolves.toMatchObject({
      total: 0,
    });
    // saytdan buyurtma — sotuvchi yo‘q, kabinet xabari ham yo‘q
    await orders.onOrderStatus(
      orderEvent(LeadOrderStatus.CONFIRMED, {
        orderId: '1290',
        affiliateId: null,
        source: 'SITE',
      }),
    );
    const [{ count }] = (await ds.query(
      `SELECT count(*)::int AS count FROM notification.notification WHERE data->>'orderId' = '1290' AND user_id IS NOT NULL`,
    )) as Array<{ count: number }>;
    expect(count).toBe(0);
  });

  it('TC2: postavka qabul qilindi, 2 dona brak — optovik kabinetida; kabineti yo‘q optovikka — yo‘q', async () => {
    const received = {
      shipmentId: '7',
      number: 'PS-000007',
      wholesalerId: '15',
      status: InboundShipmentStatus.DISCREPANCY,
      declaredQty: 10,
      receivedQty: 10,
      defectiveQty: 2,
    };
    await cabinet.onInboundReceived(received);
    await cabinet.onInboundReceived(received); // takror
    expect(await rowsOf('501')).toEqual([
      {
        type: 'inbound_defect',
        title: 'Postavka qabul qilindi, brak topildi',
        // «qabul» — yaroqlisi (10 keldi − 2 brak), qabul akti bilan bir xil
        body: 'Postavka PS-000007: 8 dona qabul qilindi, brak 2 dona.',
      },
    ]);
    await cabinet.onInboundReceived({
      ...received,
      shipmentId: '8',
      wholesalerId: '16',
    });
    const [{ count }] = (await ds.query(
      `SELECT count(*)::int AS count FROM notification.notification WHERE data->>'shipmentId' = '8'`,
    )) as Array<{ count: number }>;
    expect(count).toBe(0);
  });

  it('TC3: optovikka haftalik o‘tkazma to‘landi — SMS va kabinet xabari; kabineti yo‘q — faqat SMS; takror — bitta', async () => {
    const paid = {
      settlementId: '12',
      number: 'OPT-2026-48',
      wholesalerId: '15',
      amount: 1_250_000,
      periodStart: '2026-11-16',
      periodEnd: '2026-11-22',
    };
    await cabinet.onSettlementPaid(paid);
    await cabinet.onSettlementPaid(paid);
    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(sms.send.mock.calls[0][0]).toMatchObject({
      recipient: '+998901110015',
      body: expect.stringContaining('1 250 000 so‘m o‘tkazildi'),
    });
    expect((await rowsOf('501')).map((row) => row.title)).toEqual([
      'Pul o‘tkazildi',
    ]);
    await cabinet.onSettlementPaid({
      ...paid,
      settlementId: '13',
      wholesalerId: '16',
    });
    expect(sms.send).toHaveBeenCalledTimes(2);
    expect(sms.send.mock.calls[1][0].recipient).toBe('+998901110016');
  });

  it('TC4: offer qoldig‘i 0 — admin, superadmin va sahifasi bor sotuvchilarga; shu kuni takror — yo‘q', async () => {
    const depleted = { variantIds: ['901'], at: '2026-12-01T09:00:00.000Z' };
    await cabinet.onStockDepleted(depleted);
    await cabinet.onStockDepleted(depleted);
    const rows = (await ds.query(
      `SELECT user_id::text AS "userId" FROM notification.notification WHERE type = 'offer_out_of_stock' ORDER BY user_id`,
    )) as Array<{ userId: string }>;
    expect(rows.map((row) => row.userId)).toEqual(['1', '2', '77', '78']);
    expect((await rowsOf('77'))[0].body).toContain('Simsiz quloqchin');
  });

  it('TC5: boshqa foydalanuvchi xabarini «o‘qildi» qilish — 404; o‘zinikini o‘qigach o‘qilmaganlar soni kamaydi', async () => {
    await orders.onOrderStatus(orderEvent(LeadOrderStatus.CONFIRMED));
    const [row] = (await ds.query(
      `SELECT id::text FROM notification.notification WHERE user_id = 77`,
    )) as Array<{ id: string }>;
    await expect(notifications.markRead('78', row.id)).rejects.toMatchObject({
      status: 404,
    });
    expect((await notifications.findAll('77', {} as never)).unreadCount).toBe(
      1,
    );
    await notifications.markRead('77', row.id);
    expect((await notifications.findAll('77', {} as never)).unreadCount).toBe(
      0,
    );
  });
});
