import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { runAsLeader } from '../scheduling/leader-lock';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxService } from './outbox.service';
import { processOnce, processedEventTableSql } from './processed-event';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;
const SCHEMA = 'outbox_it';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * BE-03 — outbox relay, idempotent iste'molchi va cron yetakchi qulfi
 * HAQIQIY Postgres da. Ikki «servis nusxasi» — ikki alohida DataSource.
 */
describeWithPostgres('BE-03 outbox va yetakchi qulf (PostgreSQL)', () => {
  let a: DataSource;
  let b: DataSource;

  const source = () =>
    new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      schema: SCHEMA,
      entities: [OutboxEvent],
      synchronize: false,
      logging: false,
    });
  const outbox = (ds: DataSource) =>
    new OutboxService(ds.getRepository(OutboxEvent));
  const event = (id: number) => ({
    aggregateType: 'sales_order_seller',
    aggregateId: String(id),
    eventType: 'finance.payout.requested',
    payload: { eventId: `e-${id}` },
  });

  beforeAll(async () => {
    const url = new URL(testDatabaseUrl!);
    if (!url.pathname.toLowerCase().includes('test')) {
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    }
    const admin = new Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.query(`
      CREATE TABLE ${SCHEMA}.outbox_event (
        "id" BIGSERIAL PRIMARY KEY,
        "aggregate_type" VARCHAR(100) NOT NULL,
        "aggregate_id" VARCHAR(100) NOT NULL,
        "event_type" VARCHAR(100) NOT NULL,
        "payload" JSONB NOT NULL,
        "status" VARCHAR(15) NOT NULL DEFAULT 'PENDING',
        "processed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE
      )`);
    await admin.query(processedEventTableSql(SCHEMA));
    await admin.query(`CREATE TABLE ${SCHEMA}.ledger (event_id TEXT)`);
    await admin.end();
    a = await source().initialize();
    b = await source().initialize();
  });

  afterEach(async () => {
    await a.query(
      `TRUNCATE ${SCHEMA}.outbox_event, ${SCHEMA}.processed_event, ${SCHEMA}.ledger`,
    );
  });

  afterAll(async () => {
    await a?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await a?.destroy();
    await b?.destroy();
  });

  it('TC1: tranzaksiya rollback → outbox hodisasi yuborilmaydi', async () => {
    await expect(
      a.transaction(async (manager) => {
        await outbox(a).record(event(1), manager);
        throw new Error('biznes xatosi');
      }),
    ).rejects.toThrow('biznes xatosi');
    await a.transaction((manager) => outbox(a).record(event(2), manager));

    const published: string[] = [];
    await outbox(a).relayPending(async (e) => {
      published.push(e.aggregateId);
    });

    expect(published).toEqual(['2']);
  });

  it('TC2: ikki relay parallel → har hodisa bir marta', async () => {
    for (let i = 1; i <= 30; i++) await outbox(a).record(event(i));
    const published: string[] = [];
    const publish = async (e: OutboxEvent) => {
      published.push(e.aggregateId);
      await sleep(2);
    };

    const [first, second] = await Promise.all([
      outbox(a).relayPending(publish, 20),
      outbox(b).relayPending(publish, 20),
    ]);
    // qolganini keyingi urishda oladi
    const third = await outbox(a).relayPending(publish, 20);

    expect(first + second + third).toBe(30);
    expect(new Set(published).size).toBe(30);
    expect(published).toHaveLength(30);
  });

  it('TC3: bir hodisa ikki marta kelsa iste’molchi ikkinchisini e’tiborsiz qoldiradi', async () => {
    const handle = (eventId: string) =>
      processOnce(
        a,
        { table: `${SCHEMA}.processed_event`, consumer: 'finance', eventId },
        (manager) =>
          manager.query(`INSERT INTO ${SCHEMA}.ledger VALUES ($1)`, [eventId]),
      );

    const first = await handle('e-1');
    const second = await handle('e-1');
    // bir vaqtda kelgan ikki nusxa
    const parallel = await Promise.all([handle('e-2'), handle('e-2')]);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(parallel.filter((r) => !r.duplicate)).toHaveLength(1);
    const rows = await a.query(
      `SELECT event_id FROM ${SCHEMA}.ledger ORDER BY 1`,
    );
    expect(rows).toEqual([{ event_id: 'e-1' }, { event_id: 'e-2' }]);
  });

  it('TC3: iste’molchi xato bersa belgi ham qaytadi va qayta urinishda ishlaydi', async () => {
    const input = {
      table: `${SCHEMA}.processed_event`,
      consumer: 'finance',
      eventId: 'e-9',
    };
    await expect(
      processOnce(a, input, async () => {
        throw new Error('vaqtincha xato');
      }),
    ).rejects.toThrow('vaqtincha xato');
    await expect(processOnce(a, input, async () => 'ok')).resolves.toEqual({
      duplicate: false,
      result: 'ok',
    });
  });

  it('TC4: ikki servis nusxasida cron bitta nusxada ishlaydi', async () => {
    let runs = 0;
    const job = async () => {
      runs++;
      await sleep(150);
      return runs;
    };

    const [x, y] = await Promise.all([
      runAsLeader(a, 'test-cron', job),
      runAsLeader(b, 'test-cron', job),
    ]);

    expect([x.ran, y.ran].sort()).toEqual([false, true]);
    expect(runs).toBe(1);
    // qulf bo'shagan: keyingi urish ishlaydi; boshqa nomli cron to'silmaydi
    await expect(runAsLeader(b, 'test-cron', job)).resolves.toMatchObject({
      ran: true,
    });
    await expect(
      Promise.all([
        runAsLeader(a, 'cron-a', job),
        runAsLeader(b, 'cron-b', job),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ ran: true }),
      expect.objectContaining({ ran: true }),
    ]);
  });

  it('TC4: ish xato bersa ham qulf bo‘shaydi', async () => {
    await expect(
      runAsLeader(a, 'failing-cron', async () => {
        throw new Error('cron xatosi');
      }),
    ).rejects.toThrow('cron xatosi');
    await expect(
      runAsLeader(b, 'failing-cron', async () => 1),
    ).resolves.toEqual({ ran: true, result: 1 });
  });
});
