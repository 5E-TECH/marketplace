import { test } from 'node:test';
import assert from 'node:assert/strict';

// No sockets or external webhooks: exercise the actual monitor state machine.
test('consumer outage retries failed alerts, deduplicates and retries recovery', async (t) => {
  process.env.MONITOR_FAILURE_THRESHOLD = '2';
  process.env.MONITOR_API_URL = 'http://monitor.test/health';
  process.env.RABBITMQ_MANAGEMENT_URL = 'http://rabbit.test';
  process.env.ALERT_WEBHOOK_URL = 'http://alerts.test';
  const queues = [
    'echo',
    'identity',
    'catalog',
    'inventory',
    'checkout',
    'payment',
    'finance',
    'integration',
    'notification',
    'search',
    'file',
    'lead',
  ];
  let down = true;
  let rejectAlert = true;
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === process.env.ALERT_WEBHOOK_URL) {
      sent.push(JSON.parse(options.body).status);
      return { ok: !rejectAlert, status: rejectAlert ? 503 : 200 };
    }
    if (url.includes('/api/queues/')) {
      return {
        ok: true,
        json: async () =>
          queues.map((name) => ({
            name: `${name}_queue_v2`,
            consumers: down && name === 'catalog' ? 0 : 1,
          })),
      };
    }
    return { ok: true };
  });
  const logs = [];
  t.mock.method(console, 'log', (line) => logs.push(JSON.parse(line)));
  t.mock.method(console, 'error', (line) => logs.push(JSON.parse(line)));
  const { tick } = await import('../health-monitor.mjs');
  await tick();
  assert.deepEqual(sent, []);
  await tick(); // Failed delivery must not suppress subsequent attempts.
  rejectAlert = false;
  await tick();
  await tick();
  assert.deepEqual(sent, ['firing', 'firing']);
  down = false;
  rejectAlert = true;
  await tick();
  rejectAlert = false;
  await tick();
  await tick();
  assert.deepEqual(sent, ['firing', 'firing', 'resolved', 'resolved']);
  assert.equal(logs.filter((row) => row.status === 'unhealthy').length, 4);
  assert.equal(logs.filter((row) => row.status === 'alert_failed').length, 2);
  assert.ok(logs.some((row) => row.detail?.includes('catalog_queue_v2')));
});

test('BE-02: DLQ ogohlantirishi alohida — asosiy ogohlantirishni bosmaydi', async (t) => {
  process.env.MONITOR_FAILURE_THRESHOLD = '1';
  process.env.RABBITMQ_MANAGEMENT_URL = 'http://rabbit.test';
  process.env.MONITOR_API_URL = 'http://monitor.test/health';
  process.env.ALERT_WEBHOOK_URL = 'http://alerts.test';
  const names = [
    'echo',
    'identity',
    'catalog',
    'inventory',
    'checkout',
    'payment',
    'finance',
    'integration',
    'notification',
    'search',
    'file',
    'lead',
  ];
  let deadLetters = 2;
  let catalogDown = false;
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === process.env.ALERT_WEBHOOK_URL) {
      sent.push(JSON.parse(options.body).status);
      return { ok: true, status: 200 };
    }
    if (url.includes('/api/queues/'))
      return {
        ok: true,
        json: async () => [
          ...names.map((name) => ({
            name: `${name}_queue_v2`,
            consumers: catalogDown && name === 'catalog' ? 0 : 1,
            messages: 0,
          })),
          { name: 'lead_queue_v2.dlq', consumers: 0, messages: deadLetters },
        ],
      };
    return { ok: true };
  });
  t.mock.method(console, 'log', () => undefined);
  t.mock.method(console, 'error', () => undefined);
  const { tick } = await import(`../health-monitor.mjs?dlq=${Date.now()}`);
  await tick();
  assert.deepEqual(sent, ['dlq_firing']);
  await tick(); // takror emas
  catalogDown = true;
  await tick(); // DLQ ochiq bo'lsa ham consumer uzilishi ogohlantiriladi
  assert.deepEqual(sent, ['dlq_firing', 'firing']);
  catalogDown = false;
  deadLetters = 0;
  await tick();
  assert.deepEqual(sent, ['dlq_firing', 'firing', 'dlq_resolved', 'resolved']);
});

test('BE-13 TC10: sotuvchi sahifasi /healthz javob bermasa — ogohlantirish, tiklansa — resolved', async (t) => {
  process.env.MONITOR_FAILURE_THRESHOLD = '1';
  process.env.RABBITMQ_MANAGEMENT_URL = '';
  process.env.MONITOR_API_URL = 'http://monitor.test/health';
  process.env.MONITOR_LANDING_URL = 'http://landing.test/healthz';
  process.env.ALERT_WEBHOOK_URL = 'http://alerts.test';
  let landingUp = false;
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === process.env.ALERT_WEBHOOK_URL) {
      sent.push(JSON.parse(options.body));
      return { ok: true, status: 200 };
    }
    if (url === process.env.MONITOR_LANDING_URL)
      return { ok: landingUp, status: landingUp ? 200 : 503 };
    return { ok: true };
  });
  t.mock.method(console, 'log', () => undefined);
  t.mock.method(console, 'error', () => undefined);
  const { tick } = await import(`../health-monitor.mjs?landing=${Date.now()}`);
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, 'firing');
  assert.match(sent[0].detail, /sotuvchi sahifasi: HTTP 503/);
  landingUp = true;
  await tick();
  assert.deepEqual(
    sent.map((alert) => alert.status),
    ['firing', 'resolved'],
  );
  delete process.env.MONITOR_LANDING_URL;
});
