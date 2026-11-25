// BE-37 / QA-04 yuklama vositasi: o'lchov yadrosi (percentile, xulosa, ochiq sikl, so'rov
// vaqti) va login tokeni.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { accessTokenFrom } from '../load-test/common.mjs';
import {
  openLoop,
  percentile,
  summarize,
  timedRequest,
} from '../load-test/measure.mjs';

test('percentile uses nearest rank', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(values, 50), 50);
  assert.equal(percentile(values, 95), 95);
  assert.equal(percentile(values, 99), 99);
  assert.equal(percentile(values, 100), 100);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([], 95), null);
  // Tartiblanmagan kirish ham to'g'ri hisoblanadi va o'zgartirilmaydi.
  const shuffled = [30, 10, 20];
  assert.equal(percentile(shuffled, 50), 20);
  assert.deepEqual(shuffled, [30, 10, 20]);
});

test('summarize fails on errors, slow p95 or missing requests', () => {
  const fast = Array.from({ length: 100 }, () => ({
    ok: true,
    status: 201,
    ms: 50,
  }));
  const options = { p95Ms: 300, durationMs: 10_000, rate: 10 };
  const ok = summarize('leads', fast, options);
  assert.equal(ok.passed, true);
  assert.equal(ok.p95, 50);
  assert.equal(ok.achievedRate, 10);

  const slow = summarize(
    'leads',
    [
      ...fast.slice(0, 94),
      ...Array.from({ length: 6 }, () => ({ ok: true, status: 201, ms: 300 })),
    ],
    options,
  );
  assert.equal(slow.passed, false);
  assert.match(slow.failures.join(), /p95 300 ms/);

  const failed = summarize(
    'leads',
    [
      ...fast.slice(0, 98),
      { ok: false, status: 429, ms: 5 },
      { ok: false, status: 0, ms: 0, error: 'overload' },
    ],
    options,
  );
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.errorsByStatus, { 429: 1, overload: 1 });

  // Yuborilmagan (overload) so'rov: 0 ms i p50 ga kirsa 10 chiqardi; tezlikka ham kirmaydi.
  const mixed = summarize(
    'leads',
    [
      { ok: true, status: 201, ms: 10 },
      { ok: true, status: 201, ms: 20 },
      { ok: true, status: 201, ms: 30 },
      { ok: false, status: 0, ms: 0, error: 'overload' },
    ],
    { p95Ms: 300, durationMs: 1000 },
  );
  assert.equal(mixed.p50, 20);
  assert.equal(mixed.max, 30);
  assert.equal(mixed.achievedRate, 3);
  // Timeout va tarmoq xatosi yuborilgan — o'lchangan vaqti bilan dumga kiradi.
  const timedOut = summarize(
    'leads',
    [
      ...fast.slice(0, 99),
      { ok: false, status: 0, ms: 10_000, error: 'timeout' },
    ],
    options,
  );
  assert.equal(timedOut.max, 10_000);
  assert.equal(timedOut.p99, 50);
  assert.equal(
    summarize(
      'leads',
      [
        ...fast.slice(0, 98),
        ...Array.from({ length: 2 }, () => ({
          ok: false,
          status: 0,
          ms: 10_000,
          error: 'timeout',
        })),
      ],
      options,
    ).p99,
    10_000,
  );
  // Uzoq yugurish (100 lid/s × 1 soat): max hisobi stekni to'ldirmaydi.
  const many = Array.from({ length: 360_000 }, (_, i) => ({
    ok: true,
    status: 201,
    ms: i % 100,
  }));
  assert.equal(
    summarize('leads', many, { p95Ms: 300, durationMs: 3_600_000 }).max,
    99,
  );

  // Yuborish oynasi rejadagidan uzun bo'lsa (event loop kechikdi) — tezlik shunga bo'linadi.
  assert.equal(
    summarize('leads', fast, { ...options, windowMs: 20_000 }).achievedRate,
    5,
  );

  const short = summarize('leads', fast.slice(0, 90), options);
  assert.equal(short.passed, false);
  assert.match(short.failures.join(), /90\/100/);

  const empty = summarize('leads', [], { p95Ms: 300, durationMs: 1000 });
  assert.equal(empty.passed, false);
});

test('openLoop keeps the rate and does not wait for slow responses', async () => {
  const sentAt = [];
  const actualAt = [];
  const { samples, elapsedMs, sendWindowMs } = await openLoop({
    rate: 50,
    durationMs: 400,
    maxInflight: 100,
    task: async (i, scheduledAt) => {
      actualAt.push(performance.now());
      sentAt.push(scheduledAt);
      await sleep(150); // har javob 150 ms — oraliqdan (20 ms) ancha uzun
      return { ok: true, status: 201, ms: 150 };
    },
  });
  assert.equal(samples.length, 20);
  assert.equal(sentAt.length, 20);
  // Yopiq siklda 20 × 150 ms = 3 s ketardi; ochiq siklda ~400 + 150 ms.
  assert.ok(elapsedMs < 1000, `elapsed ${elapsedMs}`);
  // Reja: aniq har 20 ms.
  const gaps = sentAt.slice(1).map((t, i) => t - sentAt[i]);
  for (const gap of gaps) assert.ok(Math.abs(gap - 20) < 0.001);
  // Haqiqatda ham: hech biri rejadan oldin ketmaydi, hammasi birdaniga ham ketmaydi.
  for (let i = 0; i < 20; i += 1) {
    assert.ok(actualAt[i] >= sentAt[i] - 1, `${i}: rejadan oldin`);
  }
  const span = actualAt.at(-1) - actualAt[0];
  assert.ok(span >= 370 && span < 700, `span ${span}`);
  assert.ok(
    sendWindowMs >= 390 && sendWindowMs < 700,
    `window ${sendWindowMs}`,
  );
});

test('timedRequest: kechikish rejalashtirilgan vaqtdan (coordinated omission yo‘q)', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('{"data":{"leadId":"1"}}', {
        status: 201,
        headers: { 'x-ratelimit-remaining': '7' },
      }),
  );
  const sample = await timedRequest('http://localhost/x', {
    scheduledAt: performance.now() - 500,
  });
  assert.equal(sample.ok, true);
  assert.equal(sample.status, 201);
  assert.ok(sample.ms >= 500, `ms ${sample.ms}`);
  assert.equal(sample.body.data.leadId, '1');
  assert.equal(sample.headers.get('x-ratelimit-remaining'), '7');
});

test('timedRequest: timeout va tarmoq xatosi — status 0, xato nomi bilan', async (t) => {
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    (url, { signal }) =>
      new Promise((resolvePromise, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
  );
  // AbortSignal.timeout taymeri unref: haqiqiy fetch'da socket jarayonni ushlab turadi,
  // soxtasida esa yo'q — shuning uchun test o'zi ushlab turadi.
  const hold = setTimeout(() => {}, 5000);
  t.after(() => clearTimeout(hold));
  const slow = await timedRequest('http://localhost/x', { timeoutMs: 50 });
  assert.deepEqual(
    { ok: slow.ok, status: slow.status, error: slow.error },
    { ok: false, status: 0, error: 'timeout' },
  );
  assert.ok(slow.ms >= 45, `ms ${slow.ms}`);

  fetchMock.mock.mockImplementation(async () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
    });
  });
  const refused = await timedRequest('http://localhost/x');
  assert.equal(refused.status, 0);
  assert.equal(refused.error, 'ECONNREFUSED');
});

test('login tokeni: tanada yoki accessToken cookie’da (AUTH_TOKENS_IN_BODY=false)', () => {
  assert.equal(accessTokenFrom({ body: { accessToken: 'a.b.c' } }), 'a.b.c');
  const cookies = (...list) =>
    new Response('{}', { headers: list.map((c) => ['set-cookie', c]) }).headers;
  assert.equal(
    accessTokenFrom({
      body: {},
      headers: cookies(
        'refreshToken=r; Path=/auth',
        'accessToken=x.y%2Bz; Path=/; HttpOnly; Secure',
      ),
    }),
    'x.y+z',
  );
  assert.equal(
    accessTokenFrom({ body: {}, headers: cookies('xaccessToken=no') }),
    null,
  );
  assert.equal(accessTokenFrom({ body: null, headers: cookies() }), null);
});

test('openLoop records overload instead of piling up requests', async () => {
  let release;
  const gate = new Promise((resolvePromise) => {
    release = resolvePromise;
  });
  const done = openLoop({
    rate: 100,
    durationMs: 100,
    maxInflight: 3,
    task: async () => {
      await gate;
      return { ok: true, status: 201, ms: 1 };
    },
  });
  await sleep(150);
  release();
  const { samples } = await done;
  assert.equal(samples.length, 10);
  assert.equal(samples.filter((s) => s.ok).length, 3);
  assert.equal(samples.filter((s) => s.error === 'overload').length, 7);
});
