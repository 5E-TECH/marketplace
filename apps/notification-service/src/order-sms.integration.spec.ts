import { Client } from 'pg';
import { of, throwError } from 'rxjs';
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
import { OrderSmsJournalService } from './order-sms-journal.service';

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
      new OrderSmsJournalService(ds.getRepository(Notification), notifications),
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

  it('DLQ dan qayta: xabar bor, yetkazish yo‘q — yetkazish yoziladi va SMS ketadi; «Yo‘lda» treksiz — SMS yo‘q', async () => {
    await ds.query(
      `INSERT INTO notification.notification (user_id, type, title, body, data, is_read, dedupe_key)
       VALUES (NULL, 'order_confirmed', 't', 'b', '{}'::jsonb, FALSE, 'order:1284:CONFIRMED')`,
    );
    await controller.onOrderStatus(event(LeadOrderStatus.CONFIRMED));
    expect(sms.send).toHaveBeenCalledTimes(1);
    const [{ n }] = (await ds.query(
      `SELECT count(*)::int AS n FROM notification.notification_delivery`,
    )) as Array<{
      n: number;
    }>;
    expect(n).toBe(1);

    await controller.onOrderStatus(
      event(LeadOrderStatus.IN_TRANSIT, { parcel: null }),
    );
    expect(sms.send).toHaveBeenCalledTimes(1);
  });

  it('identity ishlamasa «pul o‘tkazildi» xatosi qaytadi (DLQ — keyin qayta), foydalanuvchi yo‘q (404) — tashlanadi', async () => {
    const notifications = new NotificationService(
      ds.getRepository(Notification),
      ds.getRepository(NotificationDelivery),
      [sms as never],
    );
    const paid = {
      withdrawalId: '6',
      affiliateId: '42',
      amount: 100000,
      tax: 1000,
      net: 99000,
    };
    const down = new OrderSmsController(
      notifications,
      {} as never,
      { send: () => of({ ok: false }) } as never,
      {
        send: () => throwError(() => ({ status: 500, message: 'timeout' })),
      } as never,
    );
    await expect(down.onWithdrawalPaid(paid)).rejects.toMatchObject({
      status: 500,
    });
    const missing = new OrderSmsController(
      notifications,
      {} as never,
      { send: () => of({ ok: false }) } as never,
      {
        send: () => throwError(() => ({ status: 404, message: 'yo‘q' })),
      } as never,
    );
    await expect(missing.onWithdrawalPaid(paid)).resolves.toBeUndefined();
    expect(sms.send).not.toHaveBeenCalled();
  });

  describe('BE-25 (FE-26): SMS jurnali va qayta yuborish', () => {
    const resend = (template: string) =>
      controller.resend({ orderId: '1284', template, actorId: '7' });

    it('jurnal: yuborilgani vaqti bilan, boshqa buyurtma va kabinet xabari aralashmaydi', async () => {
      await controller.onOrderStatus(event(LeadOrderStatus.CONFIRMED));
      await controller.onOrderStatus(
        event(LeadOrderStatus.CONFIRMED, {
          orderId: '1285',
          affiliateId: '42',
        } as never),
      );
      const journal = await controller.list({ orderId: '1284' });
      expect(journal).toEqual([
        {
          template: 'order_confirmed',
          title: 'Buyurtma tasdiqlandi',
          at: expect.any(String),
          detail: null,
          state: 'SENT',
        },
      ]);
    });

    it('shablon kodi yoki jurnaldagi sarlavha bilan: o‘sha matn va raqam; sarlavhalar takrorlanmaydi', async () => {
      await controller.onOrderStatus(event(LeadOrderStatus.CONFIRMED));
      const first = sms.send.mock.calls[0][0] as { body: string };
      await expect(resend('Buyurtma tasdiqlandi')).resolves.toMatchObject({
        template: 'order_confirmed',
        title: 'Buyurtma tasdiqlandi — qayta yuborildi',
        state: 'SENT',
      });
      await expect(
        resend('Buyurtma tasdiqlandi — qayta yuborildi'),
      ).resolves.toMatchObject({
        title: 'Buyurtma tasdiqlandi — qayta yuborildi (2)',
      });
      await expect(resend('order_confirmed')).resolves.toMatchObject({
        title: 'Buyurtma tasdiqlandi — qayta yuborildi (3)',
      });
      expect(sms.send).toHaveBeenCalledTimes(4);
      for (const [message] of sms.send.mock.calls)
        expect(message).toMatchObject({
          recipient: '+998901234567',
          body: first.body,
        });
      const rows = (await ds.query(
        `SELECT data->>'resentBy' AS by FROM notification.notification ORDER BY id`,
      )) as Array<{ by: string | null }>;
      expect(rows.map((row) => row.by)).toEqual([null, '7', '7', '7']);
    });

    it('yuborilmagan shablon — 404; navbatda turgani — 409; provayder sozlanmagan — 503', async () => {
      await controller.onOrderStatus(event(LeadOrderStatus.CONFIRMED));
      await expect(resend('order_in_transit')).rejects.toMatchObject({
        status: 404,
      });
      await expect(resend('boshqa')).rejects.toMatchObject({ status: 404 });

      sms.send.mockRejectedValueOnce(new Error('provayder'));
      await expect(resend('order_confirmed')).resolves.toMatchObject({
        state: 'PENDING',
        detail: 'yuborish navbatida',
      });
      await expect(resend('order_confirmed')).rejects.toMatchObject({
        status: 409,
      });
      await ds.query(
        `UPDATE notification.notification_delivery SET status = 'SENT', sent_at = now()`,
      );
      sms.isConfigured = () => false;
      await expect(resend('order_confirmed')).rejects.toMatchObject({
        status: 503,
      });
    });

    it('bir vaqtda ikki admin — bitta SMS', async () => {
      await controller.onOrderStatus(event(LeadOrderStatus.CONFIRMED));
      await Promise.allSettled([
        resend('order_confirmed'),
        resend('order_confirmed'),
      ]);
      expect(sms.send).toHaveBeenCalledTimes(2);
    });
  });
});
