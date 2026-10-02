import { Client } from 'pg';
import { Observable, of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { Broadcast } from './entities/broadcast.entity';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { Notification } from './entities/notification.entity';
import { CreateNotificationTables1722686400000 } from './migrations/1722686400000-create-notification-tables';
import { CreateTemplatesAndBroadcasts1727136000000 } from './migrations/1727136000000-create-templates-and-broadcasts';
import {
  BROADCAST_BATCH,
  BROADCAST_MAX_ATTEMPTS,
  BroadcastService,
} from './broadcast.service';
import { NotificationService } from './notification.service';
import { NotificationTemplateService } from './notification-template.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

/** 120 ta sotuvchi — BROADCAST_BATCH (50) bo'yicha 3 bo'lak. */
const SELLERS = Array.from({ length: 120 }, (_, index) => ({
  id: String(1000 + index),
  phone: `+998900000${String(index).padStart(3, '0')}`,
  email: null,
}));

/**
 * Soxta identity: `failOn` — shu kursordan keyingi bo'lak so'ralganda xato
 * (identity vaqtincha ishlamay qolgan holat).
 */
function fakeIdentity() {
  const state = { failOn: null as string | null, failTimes: 0 };
  const client = {
    send: (
      pattern: { cmd: string },
      data: { afterId?: string | null; limit: number },
    ): Observable<unknown> => {
      if (pattern.cmd === 'identity.broadcast.count')
        return of({ count: SELLERS.length });
      if (state.failTimes > 0 && (data.afterId ?? null) === state.failOn) {
        state.failTimes--;
        return throwError(() => new Error('identity vaqtincha ishlamayapti'));
      }
      const start = data.afterId
        ? SELLERS.findIndex((user) => user.id === data.afterId) + 1
        : 0;
      const items = SELLERS.slice(start, start + data.limit);
      return of({
        items,
        nextAfterId:
          items.length === data.limit ? items[items.length - 1].id : null,
      });
    },
  };
  return { client, state };
}

/**
 * C6.8 — ommaviy xabar HAQIQIY Postgres'da: noyob token, bo'lak-bo'lak
 * yuborish, uzilishdan keyin kursordan davom etish (takrorsiz).
 *
 *   TEST_DATABASE_URL=postgresql://.../marketplace_test npx jest broadcast.integration
 */
describeWithPostgres('BroadcastService PostgreSQL (C6.8)', () => {
  let dataSource: DataSource;
  let identity: ReturnType<typeof fakeIdentity>;
  let broadcasts: BroadcastService;
  let templates: NotificationTemplateService;

  const message = {
    audience: 'sellers' as const,
    channels: [],
    title: 'Aksiya',
    body: 'Bugun barcha tovarlarga 20% chegirma',
  };

  /** Fondagi yuborish shartga yetguncha kutadi (test undan oldin tugamasin). */
  const waitUntil = async (id: string, done: (row: Broadcast) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const row = await dataSource
        .getRepository(Broadcast)
        .findOneByOrFail({ id });
      if (done(row)) return row;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Broadcast ${id} kutilgan holatga yetmadi`);
  };
  const finished = (row: Broadcast) => row.status === 'DONE';
  /** Urinish xato bilan tugadi — cron qayta olishini kutyapti. */
  const stopped = (row: Broadcast) =>
    row.status === 'SENDING' && row.lastError !== null;

  const notificationsPerUser = async (broadcastId: string) =>
    (await dataSource.query(
      `SELECT user_id::text AS "userId", COUNT(*)::int AS count
         FROM notification.notification
        WHERE type='broadcast' AND data->>'broadcastId'=$1
        GROUP BY user_id`,
      [broadcastId],
    )) as Array<{ userId: string; count: number }>;

  beforeAll(async () => {
    const databaseUrl = new URL(testDatabaseUrl!);
    if (!databaseUrl.pathname.toLowerCase().includes('test')) {
      throw new Error(
        'TEST_DATABASE_URL faqat nomida "test" bor alohida bazaga ishora qilishi kerak',
      );
    }
    const admin = new Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query('DROP SCHEMA IF EXISTS notification CASCADE');
    await admin.query('CREATE SCHEMA notification');
    await admin.end();

    dataSource = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      schema: 'notification',
      entities: [
        Notification,
        NotificationDelivery,
        NotificationTemplate,
        Broadcast,
      ],
      migrations: [
        CreateNotificationTables1722686400000,
        CreateTemplatesAndBroadcasts1727136000000,
      ],
      migrationsRun: true,
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    await dataSource.query(
      // RESTART IDENTITY yo'q: id qayta ishlatilmasin — oldingi testning fon
      // jarayoni yangi yozuvga aralashib ketmasin.
      'TRUNCATE notification.broadcast, notification.notification, notification.notification_template CASCADE',
    );
    identity = fakeIdentity();
    const notifications = new NotificationService(
      dataSource.getRepository(Notification),
      dataSource.getRepository(NotificationDelivery),
      [],
    );
    broadcasts = new BroadcastService(
      dataSource.getRepository(Broadcast),
      notifications,
      identity.client as never,
    );
    templates = new NotificationTemplateService(
      dataSource.getRepository(NotificationTemplate),
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('TC3: ko‘rib chiqilgan xabar tanlangan guruhning har biriga bir marta boradi', async () => {
    const preview = await broadcasts.preview(message);
    expect(preview.recipientsCount).toBe(120);

    const sent = await broadcasts.send(
      { ...message, previewToken: preview.previewToken },
      '1',
    );
    expect(sent).toMatchObject({
      status: 'QUEUED',
      recipientsCount: 120,
      createdBy: '1',
    });

    const done = await waitUntil(sent.id, finished);
    expect(done).toMatchObject({ sentCount: 120, cursor: '1119', attempts: 0 });
    const perUser = await notificationsPerUser(sent.id);
    expect(perUser).toHaveLength(120);
    expect(perUser.every((row) => row.count === 1)).toBe(true);
  });

  it('bir xil token ikkinchi marta yubormaydi; matn o‘zgarsa 409', async () => {
    const preview = await broadcasts.preview(message);
    const first = await broadcasts.send({
      ...message,
      previewToken: preview.previewToken,
    });
    await waitUntil(first.id, finished);

    const again = await broadcasts.send({
      ...message,
      previewToken: preview.previewToken,
    });
    expect(again).toMatchObject({ id: first.id, idempotent: true });
    expect(await notificationsPerUser(first.id)).toHaveLength(120);

    await expect(
      broadcasts.send({
        ...message,
        body: 'Boshqa matn',
        previewToken: (await broadcasts.preview({ ...message, title: 'X' }))
          .previewToken,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(dataSource.getRepository(Broadcast).count()).resolves.toBe(1);
  });

  it('identity yarim yo‘lda yiqilsa — to‘xtagan joyidan davom etadi, takrorsiz', async () => {
    identity.state.failOn = SELLERS[BROADCAST_BATCH - 1].id; // 2-bo'lakda
    identity.state.failTimes = 1;
    const preview = await broadcasts.preview(message);
    const sent = await broadcasts.send({
      ...message,
      previewToken: preview.previewToken,
    });

    const halfway = await waitUntil(sent.id, stopped);
    expect(halfway).toMatchObject({
      status: 'SENDING',
      sentCount: BROADCAST_BATCH,
      cursor: SELLERS[BROADCAST_BATCH - 1].id,
      attempts: 1,
      // Ichki xato matni sendRpc'da umumiy xabarga almashadi (asl sabab log'da).
      lastError: expect.any(String),
    });

    // Cron to'xtab qolganini (2 daqiqa yangilanmagan) qayta oladi.
    await dataSource.query(
      `UPDATE notification.broadcast SET updated_at = now() - INTERVAL '5 minutes' WHERE id=$1`,
      [sent.id],
    );
    await broadcasts.resumeStale();

    const done = await dataSource
      .getRepository(Broadcast)
      .findOneByOrFail({ id: sent.id });
    expect(done).toMatchObject({
      status: 'DONE',
      sentCount: 120,
      attempts: 0,
      lastError: null,
    });
    const perUser = await notificationsPerUser(sent.id);
    expect(perUser).toHaveLength(120);
    expect(perUser.every((row) => row.count === 1)).toBe(true);
  });

  it(`${BROADCAST_MAX_ATTEMPTS} marta ketma-ket xatodan keyin FAILED`, async () => {
    identity.state.failOn = null;
    identity.state.failTimes = 1000;
    const preview = await broadcasts.preview(message);
    const sent = await broadcasts.send({
      ...message,
      previewToken: preview.previewToken,
    });
    await waitUntil(sent.id, stopped); // 1-urinish send() dan keyin fonda
    for (let i = 1; i < BROADCAST_MAX_ATTEMPTS; i++) {
      await dataSource.query(
        `UPDATE notification.broadcast SET updated_at = now() - INTERVAL '5 minutes' WHERE id=$1 AND status='SENDING'`,
        [sent.id],
      );
      await broadcasts.resumeStale();
    }
    const failed = await dataSource
      .getRepository(Broadcast)
      .findOneByOrFail({ id: sent.id });
    expect(failed).toMatchObject({
      status: 'FAILED',
      attempts: BROADCAST_MAX_ATTEMPTS,
      sentCount: 0,
    });
    expect(failed.finishedAt).not.toBeNull();
  });

  it('TC2: tahrirlangan shablon bazadan o‘qiladi, standartga qaytariladi', async () => {
    await templates.update(
      'shop_approved',
      {
        title: 'Tabriklaymiz!',
        body: '{shopName} endi sotuvda',
      },
      '1',
    );
    await expect(
      templates.render('shop_approved', { shopName: 'Ali Shop' }),
    ).resolves.toEqual({
      title: 'Tabriklaymiz!',
      body: 'Ali Shop endi sotuvda',
    });

    await templates.reset('shop_approved');
    await expect(
      templates.render('shop_approved', { shopName: 'Ali Shop' }),
    ).resolves.toEqual({
      title: 'Do‘kon tasdiqlandi',
      body: 'Ali Shop do‘koningiz faol holatga o‘tdi.',
    });
  });
});
