import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

async function run(t, scenario, replies, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'c46-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const scenarioPath = join(dir, 'scenario.json');
  const report = join(dir, 'report.json');
  const mock = join(dir, 'fetch.mjs');
  await writeFile(scenarioPath, JSON.stringify(scenario));
  await writeFile(
    mock,
    `import assert from 'node:assert/strict';
const replies = ${JSON.stringify(replies)};
globalThis.fetch = async (url, options) => {
  const next = replies.shift();
  assert.ok(next, 'Unexpected request');
  if (next.body) assert.deepEqual(JSON.parse(options.body), next.body);
  if (next.bearer) assert.equal(options.headers.authorization, next.bearer);
  return { status: next.status ?? 200, headers: { get: () => 'test-request' }, text: async () => JSON.stringify(next.payload) };
};`,
  );
  const child = spawn(
    process.execPath,
    ['--import', mock, resolve('scripts/e2e-smoke.mjs')],
    {
      env: {
        ...process.env,
        E2E_BASE_URL: 'http://local.test',
        E2E_SCENARIO_FILE: scenarioPath,
        E2E_REPORT_FILE: report,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  const evidence = await readFile(report, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  return { code, output, evidence };
}

test('captures raw login, preserves numeric amounts and waits for the matching payout', async (t) => {
  const result = await run(
    t,
    {
      evidenceIds: ['PAYOUT_ID'],
      steps: [
        {
          name: 'login',
          method: 'POST',
          path: '/auth/login',
          capture: { TOKEN: 'accessToken' },
        },
        {
          name: 'order',
          path: '/order',
          capture: { AMOUNT: 'data.amount', ORDER_ID: 'data.id' },
        },
        {
          name: 'payment',
          method: 'POST',
          path: '/payment',
          bearer: '${TOKEN}',
          body: { amount: '${AMOUNT}' },
        },
        {
          name: 'payout',
          path: '/payout',
          wait: { attempts: 2, intervalMs: 1 },
          select: { path: 'data.items', match: { referenceId: '${ORDER_ID}' } },
          capture: { PAYOUT_ID: 'id' },
          assert: [{ path: 'status', equals: 'PAID' }],
        },
      ],
    },
    [
      { payload: { accessToken: 'private-token' } },
      { payload: { data: { amount: 12000, id: '10' } } },
      { payload: {}, body: { amount: 12000 }, bearer: 'Bearer private-token' },
      {
        payload: {
          data: { items: [{ id: '99', referenceId: 'other', status: 'PAID' }] },
        },
      },
      {
        payload: {
          data: { items: [{ id: '20', referenceId: '10', status: 'PAID' }] },
        },
      },
    ],
  );
  assert.equal(result.code, 0, result.output);
  assert.equal(result.evidence.status, 'passed');
  assert.equal(result.evidence.ids.PAYOUT_ID, '20');
  assert.ok(!JSON.stringify(result).includes('private-token'));
});

test('failed HTTP response is reported without leaking its body', async (t) => {
  const result = await run(t, { steps: [{ name: 'failure', path: '/test' }] }, [
    { status: 500, payload: { secret: 'do-not-log' } },
  ]);
  assert.equal(result.code, 1);
  assert.equal(result.evidence.status, 'failed');
  assert.ok(!result.output.includes('do-not-log'));
});

test('missing setup fails before any request; writes are never retried', async (t) => {
  const missing = await run(
    t,
    { requiredEnv: ['C46_MISSING'], steps: [{ path: '/' }] },
    [],
    { C46_MISSING: '' },
  );
  assert.equal(missing.code, 1);
  assert.match(missing.output, /C46_MISSING/);
  const write = await run(
    t,
    {
      steps: [
        { name: 'write', path: '/', method: 'POST', wait: { attempts: 2 } },
      ],
    },
    [],
  );
  assert.equal(write.code, 1);
  assert.match(write.output, /Faqat GET/);
});

test('full payout scenario verifies the created order and PAID payout', async (t) => {
  const scenario = JSON.parse(await readFile('deploy/e2e-payout.json', 'utf8'));
  for (const step of scenario.steps)
    if (step.wait) step.wait = { attempts: 2, intervalMs: 1 };
  const env = Object.fromEntries(
    scenario.requiredEnv.map((key) => [key, 'test-value']),
  );
  const result = await run(
    t,
    scenario,
    [
      { payload: {} },
      { payload: { accessToken: 'admin-private-token' } },
      {
        payload: {
          data: { accessToken: 'buyer-private-token', user: { id: '1' } },
        },
      },
      { payload: { data: { totalQuantity: 1 } } },
      {
        payload: {
          data: {
            id: '2',
            status: 'PENDING_PAYMENT',
            totalAmount: 100,
            sellerOrders: [{ id: '3', shopId: '4' }],
          },
        },
      },
      {
        payload: { data: { id: '5', salesOrderId: '2' } },
        body: { salesOrderId: '2', provider: 'test-value', amount: 100 },
      },
      { status: 401, payload: {} },
      { payload: { accessToken: 'renewed-private-token' } },
      {
        payload: {
          data: {
            status: 'CONFIRMED',
            sellerOrders: [{ elchiShipmentId: '6' }],
          },
        },
        bearer: 'Bearer renewed-private-token',
      },
      {
        payload: {
          data: { items: [{ id: '7', referenceId: '3', status: 'PENDING' }] },
        },
      },
      {
        payload: {
          data: {
            items: [
              {
                id: '7',
                referenceId: '3',
                status: 'PAID',
                paidAt: '2026-09-07',
              },
            ],
          },
        },
      },
    ],
    env,
  );
  assert.equal(result.code, 0, result.output);
  assert.equal(result.evidence.steps.length, 9);
  assert.equal(result.evidence.ids.PAYOUT_ID, '7');
  assert.ok(!JSON.stringify(result).includes('private-token'));
});

test('unrelated PAID payout cannot make a waiting step pass', async (t) => {
  const result = await run(
    t,
    {
      steps: [
        {
          name: 'own payout',
          path: '/payout',
          wait: { attempts: 2, intervalMs: 1 },
          select: { path: 'data.items', match: { referenceId: 'mine' } },
          assert: [{ path: 'status', equals: 'PAID' }],
        },
      ],
    },
    [
      {
        payload: {
          data: { items: [{ referenceId: 'other', status: 'PAID' }] },
        },
      },
      {
        payload: {
          data: { items: [{ referenceId: 'other', status: 'PAID' }] },
        },
      },
    ],
  );
  assert.equal(result.code, 1);
  assert.equal(result.evidence.status, 'failed');
});
