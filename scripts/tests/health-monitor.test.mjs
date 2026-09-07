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
            name: `${name}_queue`,
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
  assert.ok(logs.some((row) => row.detail?.includes('catalog_queue')));
});
