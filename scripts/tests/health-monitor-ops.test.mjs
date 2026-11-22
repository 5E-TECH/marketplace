import { test } from 'node:test';
import assert from 'node:assert/strict';

// BE-26 TC3: Elchi xatolari 5 daqiqada 10 dan oshdi → ogohlantirish; me'yorga qaytdi → «hal bo'ldi». Lid navbati ham.
test('BE-26: ko‘rsatkich ogohlantirishlari bir marta yuboriladi va hal bo‘lganda yopiladi', async (t) => {
  process.env.MONITOR_API_URL = 'http://monitor.test/api/v1/health/readiness';
  process.env.RABBITMQ_MANAGEMENT_URL = '';
  process.env.ALERT_WEBHOOK_URL = 'http://alerts.test';
  process.env.MONITOR_OPS_TOKEN = 'monitor-token-0123456789';
  let ops = {
    elchiApiErrors5m: 11,
    leadQueue: { waiting: 3, oldestMinutes: 4 },
  };
  const sent = [];
  const opsCalls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url === process.env.ALERT_WEBHOOK_URL) {
      const body = JSON.parse(options.body);
      sent.push(`${body.status}: ${body.detail}`);
      return { ok: true, status: 200 };
    }
    if (url.endsWith('/health/ops')) {
      opsCalls.push(options.headers?.['x-monitor-token']);
      return { ok: true, json: async () => ({ statusCode: 200, data: ops }) };
    }
    return { ok: true, json: async () => [] };
  });
  const { checkOps } = await import('../health-monitor.mjs');

  await checkOps();
  await checkOps(); // takror — yangi ogohlantirish yo'q
  assert.deepEqual(sent, [
    'elchi_errors_firing: Elchi API xatolari 5 daqiqada 11 (chegara 10)',
  ]);
  assert.deepEqual(opsCalls, [
    'monitor-token-0123456789',
    'monitor-token-0123456789',
  ]);

  ops = { elchiApiErrors5m: 10, leadQueue: { waiting: 25, oldestMinutes: 14 } };
  await checkOps();
  assert.deepEqual(sent.slice(1), [
    'elchi_errors_resolved: Elchi API xatolari me’yorda',
    'lead_queue_firing: Navbatda lid 14 daqiqadan beri qo‘ng‘iroqsiz (kutyapti: 25; chegara 10 daq)',
  ]);

  ops = {
    elchiApiErrors5m: null,
    leadQueue: { waiting: 0, oldestMinutes: null },
  };
  await checkOps();
  assert.deepEqual(sent.slice(3), [
    'lead_queue_resolved: Lid navbati me’yorda',
  ]);
});
