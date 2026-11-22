import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import { LeadOrderStatus, OrderStatusChangedEvent } from '@app/common';
import { NotificationChannel } from './entities/notification-delivery.entity';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { Notification } from './entities/notification.entity';
import { Broadcast } from './entities/broadcast.entity';
import { NOTIFICATION_DB } from './database';
import { NotificationService } from './notification.service';
import { OrderSmsController } from './order-sms.controller';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const NOTIFICATION_SCHEMA_TEST_LOCK = 2_304_024;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/** BE-24 (BUY-6): mijozga buyurtma SMS lari va sotuvchiga «pul o‘tkazildi» — haqiqiy PostgreSQL. */
describeWithPostgres('BE-24 SMS (PostgreSQL)', () => {
  let ds: DataSource;
  let schemaLock: Client;
  let sms: {
    channel: NotificationChannel;
    isConfigured: () => boolean;
    send: jest.Mock;
  };
  let controller: OrderSmsController;

  const event = (
    status: LeadOrderStatus,
    over: Partial<OrderStatusChangedEvent> = {},
  ) =>
    ({
      eventId: `e-${status}`,
      orderId: '1284',
      orderNumber: 'L-1284',
      status,
      recipient: {
        phone: '+998901234567',
        whereDeliver: 'CENTER',
        regionSoato: '1730',
        districtSoato: '1730401',
      },
      items: [{ name: 'Simsiz quloqchinlar', quantity: 1, salePrice: 262000 }],
      delivery: { mode: 'PARTIAL', cost: 30000 },
      codAmount: 292000,
      parcel:
        status === LeadOrderStatus.IN_TRANSIT
          ? { shipmentId: '1251131', trackingUrl: null }
          : null,
      ...over,
    }) as unknown as OrderStatusChangedEvent;

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
    const notifications = new NotificationService(
      ds.getRepository(Notification),
      ds.getRepository(NotificationDelivery),
      [sms as never],
    );
    controller = new OrderSmsController(
      notifications,
      { send: () => of({ ok: true, districtName: 'Qo‘qon shahri' }) } as never,
      { send: () => of({ id: '42', phone: '+998907776655' }) } as never,
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

  it('TC1–TC3: tasdiqlandi, yo‘lga chiqdi (trek), yetkazildi — mijoz telefoniga, foydalanuvchisiz; takror hodisa — bitta SMS', async () => {
    const started = Date.now();
    await controller.onOrderStatus(event(LeadOrderStatus.CONFIRMED));
    await controller.onOrderStatus(event(LeadOrderStatus.CONFIRMED)); // takror (at-least-once)
    await controller.onOrderStatus(event(LeadOrderStatus.PICKING)); // SMS yo‘q
    await controller.onOrderStatus(event(LeadOrderStatus.IN_TRANSIT));
    await controller.onOrderStatus(event(LeadOrderStatus.DELIVERED));
    expect(Date.now() - started).toBeLessThan(60_000); // 1 daqiqa ichida (BUY-6)

    expect(sms.send.mock.calls.map((c) => c[0].recipient)).toEqual([
      '+998901234567',
      '+998901234567',
      '+998901234567',
    ]);
    expect(sms.send.mock.calls[0][0].body).toContain(
      'Qo‘qon shahri markazigacha yetkaziladi',
    );
    expect(sms.send.mock.calls[1][0].body).toContain('Trek raqami: 1251131');
    const rows = (await ds.query(
      `SELECT user_id, dedupe_key FROM notification.notification ORDER BY id`,
    )) as Array<{ user_id: string | null; dedupe_key: string }>;
    expect(rows).toEqual([
      { user_id: null, dedupe_key: 'order:1284:CONFIRMED' },
      { user_id: null, dedupe_key: 'order:1284:IN_TRANSIT' },
      { user_id: null, dedupe_key: 'order:1284:DELIVERED' },
    ]);
  });

  it('TC5: provayder javob bermasa — xabar qayta urinish navbatida (RETRY), yo‘qolmaydi', async () => {
    sms.send.mockRejectedValueOnce(new Error('HTTP 503'));
    await controller.onOrderStatus(event(LeadOrderStatus.CONFIRMED));
    const [delivery] = (await ds.query(
      `SELECT status, attempts, next_retry_at > now() AS later FROM notification.notification_delivery`,
    )) as Array<{ status: string; attempts: number; later: boolean }>;
    expect(delivery).toMatchObject({
      status: 'RETRY',
      attempts: 1,
      later: true,
    });
  });

  it('TC4: «Pul o‘tkazildi» — sotuvchi telefoniga SMS va kabinet xabari; takror — bitta', async () => {
    const paid = {
      withdrawalId: '5',
      affiliateId: '42',
      amount: 6000000,
      tax: 60000,
      net: 5940000,
    };
    await controller.onWithdrawalPaid(paid);
    await controller.onWithdrawalPaid(paid);
    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(sms.send.mock.calls[0][0]).toMatchObject({
      recipient: '+998907776655',
      body: 'Pul kartangizga o‘tkazildi: 5 940 000 so‘m. So‘rov 6 000 000 so‘m, 1% soliq 60 000 so‘m.',
    });
    const [row] = (await ds.query(
      `SELECT user_id::text, type FROM notification.notification`,
    )) as Array<{
      user_id: string;
      type: string;
    }>;
    expect(row).toEqual({ user_id: '42', type: 'withdrawal_paid' });
  });
});
