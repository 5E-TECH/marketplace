import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { isIPv6 } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import {
  accessTokenFrom,
  findDoubleAssignments,
  ipFor,
  isLocalUrl,
  leadBody,
  openLoop,
  percentile,
  phoneFor,
  SCREEN_TOTAL,
  summarize,
  timedRequest,
} from '../load-test.mjs';

// POST /leads DTO (libs/common/src/dto/lead.dto.ts) — forbidNonWhitelisted boshqa maydonga 400 beradi.
const LEAD_FIELDS = new Set([
  'code',
  'name',
  'phone',
  'regionSoato',
  'districtSoato',
  'addressLine',
  'whereDeliver',
  'consentVersion',
  'variant',
  'sub1',
  'sub2',
  'sub3',
  'sub4',
  'sub5',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
  'fbclid',
  'confirmMode',
  'clickId',
]);

// Soxta server: fetch'ni almashtiradi, kelgan so'rovlarni chiqishda faylga yozadi.
// `handler` — (method, path, body, headers, state) => [status, payload, extraHeaders?, delayMs?]
// (string ko'rinishida). Gateway ThrottlerGuard kabi har javobda X-RateLimit-Remaining —
// har XFF IP ning o'z hisobi; `state.ignoreXff = true` — public domen kabi hammasi bitta IP.
// Dasturchi qobig'idagi LOAD_* (masalan seed chiqargan LOAD_STREAM_CODE) testga ta'sir qilmasin.
const CLEAN_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('LOAD_')),
);

async function run(t, args, handler, env = {}, { killAfterMs } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'be37-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const report = join(dir, 'report.json');
  const log = join(dir, 'requests.json');
  const mock = join(dir, 'fetch.mjs');
  await writeFile(
    mock,
    `import { writeFileSync } from 'node:fs';
const requests = [];
const hits = new Map();
const state = { hits };
const handler = ${handler};
process.on('exit', () => writeFileSync(${JSON.stringify(log)}, JSON.stringify(requests)));
globalThis.fetch = async (url, options = {}) => {
  const { pathname } = new URL(url);
  const path = pathname.replace(/^\\/api\\/v1/, '');
  const method = options.method ?? 'GET';
  const body = options.body ? JSON.parse(options.body) : undefined;
  const headers = options.headers ?? {};
  requests.push({ method, path, body, headers });
  const [status, payload, extra = [], delayMs = 0] = handler(method, path, body, headers, state);
  if (delayMs) await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
  const ip = state.ignoreXff ? 'socket' : (headers['x-forwarded-for'] ?? 'socket');
  hits.set(ip, (hits.get(ip) ?? 0) + 1);
  return new Response(JSON.stringify(payload), {
    status,
    headers: [
      ['x-ratelimit-limit', '300'],
      ['x-ratelimit-remaining', String(300 - hits.get(ip))],
      ...extra,
    ],
  });
};`,
  );
  const child = spawn(
    process.execPath,
    ['--import', mock, resolve('scripts/load-test.mjs'), ...args],
    {
      env: {
        ...CLEAN_ENV,
        LOAD_BASE_URL: 'http://localhost:3000/api/v1',
        LOAD_DURATION_SEC: '1',
        LOAD_REPORT_FILE: report,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  // Sinov boshlanib ulgurishi uchun: Ctrl+C ni taqlid qiladi.
  if (killAfterMs) setTimeout(() => child.kill('SIGINT'), killAfterMs);
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const code = await new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('close', resolvePromise);
  });
  const evidence = await readFile(report, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  const requests = await readFile(log, 'utf8')
    .then(JSON.parse)
    .catch(() => []);
  return { code, output, evidence, requests };
}

// seed yaratgan sahifa: OPEN va mahsulot nomi NAME_PREFIX bilan.
const LANDING_OK = `[200, { data: { state: 'OPEN', product: { name: 'Yuklama-sinov mahsulot t1' } } }]`;

const OPEN_LANDING = `(method, path, body, headers, state) => {
  if (path.startsWith('/landing/')) return ${LANDING_OK};
  state.n = (state.n ?? 0) + 1;
  return [201, { statusCode: 201, data: { leadId: String(state.n), duplicate: false } }];
}`;

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

test('BE-37 TC1: telefonlar bir yugurishda ham, ketma-ket yugurishlarda ham takrorlanmaydi', () => {
  const start = 1_796_000_000;
  const first = Array.from({ length: 6000 }, (_, i) => phoneFor(start, i));
  // Keyingi yugurish oldingisi tugagandan keyin (600 s) boshlanadi.
  const second = Array.from({ length: 6000 }, (_, i) =>
    phoneFor(start + 600, i),
  );
  const all = [...first, ...second];
  assert.equal(new Set(all).size, all.length);
  for (const phone of all) {
    assert.match(phone, /^\+998(90|91|93|94|95|97|98|99)\d{7}$/);
  }
});

test('BE-37 TC1: har lidga alohida, ishonchsiz (public) IPv6 manzil', () => {
  const ips = Array.from({ length: 70_000 }, (_, i) => ipFor(0xbeef, 0, i));
  assert.equal(new Set(ips).size, ips.length);
  for (const ip of [ips[0], ips[65_536], ips.at(-1), ipFor(1, 2, 3)]) {
    assert.ok(isIPv6(ip), ip);
    // 2001:db8::/32 — loopback/linklocal/uniquelocal emas, trust-proxy uni o'tkazib yubormaydi.
    assert.ok(ip.startsWith('2001:db8:'), ip);
  }
});

test('BE-37 TC1: lid tanasi faqat DTO maydonlaridan, honeypot yuborilmaydi', () => {
  const body = leadBody({
    code: 'lt1',
    runId: 'r1',
    i: 3,
    phone: '+998901234567',
    regionSoato: '1726',
    districtSoato: '1726266',
  });
  for (const key of Object.keys(body)) assert.ok(LEAD_FIELDS.has(key), key);
  assert.equal(body.website, undefined);
  assert.equal(body.sub1, 'loadtest-r1');
  assert.ok(body.name.length <= 100);
});

test('QA-04 TC4: bitta lid ikki operatorga tushsa topiladi', () => {
  assert.deepEqual(
    findDoubleAssignments([
      { leadId: '1', operator: 1 },
      { leadId: '2', operator: 2 },
      { leadId: '1', operator: 3 },
    ]),
    [{ leadId: '1', operators: [1, 3] }],
  );
  assert.deepEqual(findDoubleAssignments([{ leadId: '1', operator: 1 }]), []);
});

test('sinov faqat localhost ga, aks holda --allow-remote kerak', async (t) => {
  assert.equal(isLocalUrl('http://localhost:3000/api/v1'), true);
  assert.equal(isLocalUrl('http://127.0.0.1:3000/api/v1'), true);
  assert.equal(isLocalUrl('http://[::1]:3000/api/v1'), true);
  assert.equal(isLocalUrl('https://api.elchimarket.uz/api/v1'), false);
  // Boshqa lokal port — ko'pincha ssh tunnel (prod Swagger tunneli 13000): --allow-remote kerak.
  assert.equal(isLocalUrl('http://localhost:13000/api/v1'), false);
  assert.equal(isLocalUrl('http://localhost/api/v1'), false);

  const result = await run(t, ['leads'], OPEN_LANDING, {
    LOAD_BASE_URL: 'https://api.elchimarket.uz/api/v1',
    LOAD_STREAM_CODE: 'lt1',
  });
  assert.equal(result.code, 2);
  assert.match(result.output, /lokal stend \(localhost:3000\) emas/);
  assert.equal(result.requests.length, 0);

  // Tunnel (localhost:13000) ham — --allow-remote siz birorta so'rov ketmaydi.
  const tunnel = await run(t, ['leads'], OPEN_LANDING, {
    LOAD_BASE_URL: 'http://localhost:13000/api/v1',
    LOAD_STREAM_CODE: 'lt1',
  });
  assert.equal(tunnel.code, 2);
  assert.equal(tunnel.requests.length, 0);
});

test('BE-37 TC1: 1 soniya × 20 lid/s — tezlik, noyob telefon va IP, hisobot', async (t) => {
  const result = await run(t, ['leads'], OPEN_LANDING, {
    LOAD_STREAM_CODE: 'lt1',
    LOAD_RATE: '20',
  });
  assert.equal(result.code, 0, result.output);
  const posts = result.requests.filter((r) => r.path === '/leads');
  assert.equal(posts.length, 20);
  assert.equal(new Set(posts.map((r) => r.body.phone)).size, 20);
  assert.equal(
    new Set(posts.map((r) => r.headers['x-forwarded-for'])).size,
    20,
  );
  for (const { body } of posts) {
    for (const key of Object.keys(body)) assert.ok(LEAD_FIELDS.has(key), key);
    assert.equal(body.code, 'lt1');
  }
  // Boshida X-Forwarded-For sinovi: ikki xil IP, lid yaratmaydigan yo'l.
  const probes = result.requests.filter((r) => r.path === '/landing/xff-probe');
  assert.equal(probes.length, 2);
  assert.equal(
    new Set(probes.map((r) => r.headers['x-forwarded-for'])).size,
    2,
  );
  assert.equal(result.evidence.passed, true);
  assert.equal(result.evidence.results[0].requests, 20);
  assert.equal(result.evidence.leads.created, 20);
  assert.match(result.output, /NATIJA: o‘tdi/);
});

test('BE-37 TC1: 429, dublikat va 5xx — xato, chiqish kodi 1, javob tanasi hisobotga tushmaydi', async (t) => {
  const result = await run(
    t,
    ['leads'],
    `(method, path, body, headers, state) => {
      if (path.startsWith('/landing/')) return ${LANDING_OK};
      state.n = (state.n ?? 0) + 1;
      if (state.n === 2) return [429, { statusCode: 429, message: 'maxfiy-matn', requestId: 'req-2' }];
      if (state.n === 3) return [201, { data: { leadId: '9', duplicate: true } }];
      if (state.n === 4) return [201, { data: { leadId: '0', duplicate: false } }];
      if (state.n === 5) return [504, { statusCode: 504, errorCode: 'RPC_TIMEOUT', requestId: 'req-5' }];
      return [201, { data: { leadId: String(state.n), duplicate: false } }];
    }`,
    { LOAD_STREAM_CODE: 'lt1', LOAD_RATE: '10' },
  );
  assert.equal(result.code, 1, result.output);
  const summary = result.evidence.results[0];
  assert.deepEqual(summary.errorsByStatus, {
    429: 1,
    504: 1,
    duplicate: 1,
    honeypot: 1,
  });
  assert.equal(result.evidence.passed, false);
  assert.ok(
    result.evidence.errorExamples.some(
      (e) => e.status === 504 && e.requestId === 'req-5',
    ),
  );
  assert.doesNotMatch(result.output, /maxfiy-matn/);
  assert.match(result.output, /NATIJA: o‘tmadi/);
});

test('BE-37 TC1: sahifa OPEN bo‘lmasa lid yuborilmaydi', async (t) => {
  const result = await run(
    t,
    ['leads'],
    `(method, path) => path.startsWith('/landing/')
      ? [200, { data: { state: 'OUT_OF_STOCK' } }]
      : [201, { data: { leadId: '1', duplicate: false } }]`,
    { LOAD_STREAM_CODE: 'lt1' },
  );
  assert.equal(result.code, 2);
  assert.match(result.output, /Sahifa ochiq emas.*OUT_OF_STOCK/);
  assert.equal(result.requests.filter((r) => r.path === '/leads').length, 0);
});

test('BE-37: gateway XFF ni hisobga olmasa (public domen) — sinov boshlanmaydi', async (t) => {
  const result = await run(
    t,
    ['leads'],
    `(method, path, body, headers, state) => {
      state.ignoreXff = true;
      return path.startsWith('/landing/') ? ${LANDING_OK} : [201, { data: { leadId: '1', duplicate: false } }];
    }`,
    { LOAD_STREAM_CODE: 'lt1' },
  );
  assert.equal(result.code, 2, result.output);
  assert.match(result.output, /X-Forwarded-For ni hisobga olmayapti/);
  assert.equal(result.requests.filter((r) => r.path === '/leads').length, 0);
});

test('BE-37: XFF tekshiruvi — eski urinish oynadan chiqib ketsa ham bitta IP aniqlanadi', async (t) => {
  const result = await run(
    t,
    ['leads'],
    `(method, path, body, headers, state) => {
      state.ignoreXff = true;
      if (path === '/landing/xff-probe') {
        // Bitta haqiqiy IP: oldin 5 ta urinish bor, ikki proba orasida bittasi oynadan chiqadi —
        // ikkala probada ham qoldiq 294 (teng).
        if (state.seeded) state.hits.set('socket', state.hits.get('socket') - 1);
        else { state.seeded = true; state.hits.set('socket', 5); }
      }
      return path.startsWith('/landing/') ? ${LANDING_OK} : [201, { data: { leadId: '1', duplicate: false } }];
    }`,
    { LOAD_STREAM_CODE: 'lt1' },
  );
  assert.equal(result.code, 2, result.output);
  assert.match(result.output, /X-Forwarded-For ni hisobga olmayapti/);
  assert.equal(result.requests.filter((r) => r.path === '/leads').length, 0);
});

test('BE-37: --single-ip hech qachon «o‘tdi» emas (IP_RATE ni API ko‘rsatmaydi)', async (t) => {
  const result = await run(t, ['leads', '--single-ip'], OPEN_LANDING, {
    LOAD_STREAM_CODE: 'lt1',
  });
  assert.equal(result.code, 1, result.output);
  const posts = result.requests.filter((r) => r.path === '/leads');
  assert.equal(new Set(posts.map((r) => r.headers['x-forwarded-for'])).size, 1);
  assert.match(result.evidence.results[0].failures.join(), /namoyish rejimi/);
});

test('BE-37: Ctrl+C — yuborish to‘xtaydi, qisman hisobot yoziladi, chiqish kodi 1', async (t) => {
  const started = performance.now();
  const result = await run(
    t,
    ['leads'],
    OPEN_LANDING,
    { LOAD_STREAM_CODE: 'lt1', LOAD_RATE: '20', LOAD_DURATION_SEC: '60' },
    { killAfterMs: 1500 },
  );
  assert.equal(result.code, 1, result.output);
  assert.ok(performance.now() - started < 15_000);
  const summary = result.evidence.results[0];
  assert.ok(
    summary.requests > 0 && summary.requests < 200,
    `${summary.requests}`,
  );
  assert.match(summary.failures.join(), /SIGINT bilan to‘xtatildi/);
  assert.equal(summary.errors, 0);
});

test('BE-37: sahifa yuklama mahsulotiniki bo‘lmasa lid yuborilmaydi', async (t) => {
  const result = await run(
    t,
    ['leads'],
    `(method, path) => path.startsWith('/landing/')
      ? [200, { data: { state: 'OPEN', product: { name: 'Haqiqiy mahsulot' } } }]
      : [201, { data: { leadId: '1', duplicate: false } }]`,
    { LOAD_STREAM_CODE: 'abc' },
  );
  assert.equal(result.code, 2, result.output);
  assert.match(result.output, /yuklama mahsuloti emas/);
  assert.equal(result.requests.filter((r) => r.path === '/leads').length, 0);
});

test('LOAD_REPORT_FILE ga yozib bo‘lmasa — sinovdan oldin to‘xtaydi', async (t) => {
  const result = await run(t, ['leads'], OPEN_LANDING, {
    LOAD_STREAM_CODE: 'lt1',
    LOAD_REPORT_FILE: join(tmpdir(), 'be37-yoq-papka', 'a', 'report.json'),
  });
  assert.equal(result.code, 2, result.output);
  assert.match(result.output, /LOAD_REPORT_FILE ga yozib bo‘lmaydi: ENOENT/);
  assert.equal(result.requests.length, 0);
});

test('foydalanish xatosi: noma’lum senariy yoki bayroq, LOAD_STREAM_CODE yo‘q', async (t) => {
  for (const [args, pattern] of [
    [['nimadir'], /Foydalanish/],
    [['leads', '--tez'], /Foydalanish/],
    [['leads'], /LOAD_STREAM_CODE kerak/],
  ]) {
    const result = await run(t, args, OPEN_LANDING);
    assert.equal(result.code, 2, args.join(' '));
    assert.match(result.output, pattern);
  }
});

// Operator navbati soxta serveri: navbatda `total` ta lid, «keyingi lid» birinchisini beradi.
const QUEUE = (options = {}) => `(method, path, body, headers, state) => {
  const opts = ${JSON.stringify(options)};
  state.queue ??= Array.from({ length: opts.total ?? 200 }, (_, i) => String(i + 1));
  state.taken ??= 0;
  if (path.startsWith('/landing/')) return opts.landing ?? ${LANDING_OK};
  if (path === '/auth/login') {
    return opts.cookie
      ? [201, {}, [['set-cookie', 'accessToken=tok-' + encodeURIComponent(body.phone) + '; Path=/; HttpOnly']]]
      : [201, { accessToken: 'tok-' + body.phone }];
  }
  if (path === '/operator/queue-summary') {
    return [200, { data: { newLeads: opts.newLeads ?? state.queue.length, dueCallbacks: opts.due ?? 0, booked: 0, operators: [] } }];
  }
  if (path === '/admin/team') {
    if (opts.failTeamAt && body.phone.endsWith(String(opts.failTeamAt).padStart(3, '0'))) return [500, {}];
    return [opts.exists ? 409 : 201, {}];
  }
  if (path === '/operator/state') return [200, { data: { state: body?.state } }];
  if (path === '/operator/leads/next') {
    state.taken += 1;
    if (opts.repeatSecond && state.taken === 2) return [200, { data: { id: '1', customerName: 'Yuklama-sinov x' } }];
    const id = state.queue.shift();
    if (!id) return [404, { errorCode: 'LEAD_QUEUE_EMPTY' }];
    const name = opts.foreignId === id ? 'Aziza' : 'Yuklama-sinov ' + id;
    return [200, { data: { id, customerName: name } }, [], opts.nextDelay ?? 0];
  }
  return [200, { data: {} }, [], method === 'GET' ? (opts.screenDelay ?? 0) : 0];
}`;

const OPERATOR_ENV = {
  LOAD_STREAM_CODE: 'lt1',
  LOAD_ADMIN_PHONE: '+998900000001',
  LOAD_ADMIN_PASSWORD: 'admin-parol',
  LOAD_OPERATOR_PASSWORD: 'operator-parol',
  LOAD_OPERATORS: '3',
  LOAD_OPERATOR_PAUSE_MS: '0',
};

test('QA-04 TC2/TC4: operatorlar yaratiladi, ONLINE bo‘ladi, lidlar bitta operatorga tushadi', async (t) => {
  const result = await run(t, ['operators'], QUEUE({ total: 30 }), {
    ...OPERATOR_ENV,
  });
  assert.equal(result.code, 0, result.output);
  const report = result.evidence;
  assert.equal(report.passed, true);
  assert.deepEqual(report.burst, { operators: 3, distinctLeads: 3 });
  assert.equal(report.leadsTaken, 30);
  assert.deepEqual(report.doubleAssignments, []);
  const names = report.results.map((r) => r.name).sort();
  assert.ok(names.includes('POST /operator/leads/next'));
  assert.ok(names.includes('GET /operator/leads/:id'));
  assert.ok(names.includes('POST /operator/leads/:id/result'));
  // TC2: butun ekran (keyingi lid + 5 GET) har lid uchun bitta namuna.
  const screen = report.results.find((r) => r.name === SCREEN_TOTAL);
  assert.equal(screen.requests, 30);
  assert.equal(screen.passed, true);
  assert.equal(report.queueAtStart.newLeads, 30);
  // Har operator o'z IP sidan; har lid INVALID bilan yopiladi.
  const logins = result.requests.filter((r) => r.path === '/auth/login');
  assert.equal(logins.length, 4);
  assert.equal(
    new Set(logins.map((r) => r.headers['x-forwarded-for'])).size,
    4,
  );
  const closed = result.requests.filter((r) => r.path.endsWith('/result'));
  assert.equal(closed.length, 30);
  assert.ok(closed.every((r) => r.body.outcome === 'INVALID'));
  // Boshida ONLINE, oxirida hamma operator OFFLINE (GET /operator/state — ekran so'rovi).
  const states = result.requests.filter(
    (r) => r.method === 'PUT' && r.path === '/operator/state',
  );
  assert.deepEqual(
    states.map((r) => r.body.state),
    ['ONLINE', 'ONLINE', 'ONLINE', 'OFFLINE', 'OFFLINE', 'OFFLINE'],
  );
  // Parol va tokenlar chiqishga tushmaydi.
  assert.doesNotMatch(result.output, /operator-parol|admin-parol|tok-/);
});

test('QA-04 TC2: ekran vaqti — keyingi lid + eng sekin GET (5 GET parallel)', async (t) => {
  const result = await run(
    t,
    ['operators'],
    QUEUE({ total: 30, screenDelay: 150, nextDelay: 100 }),
    { ...OPERATOR_ENV, LOAD_OPERATORS: '1' },
  );
  assert.equal(result.code, 0, result.output);
  const screen = result.evidence.results.find((r) => r.name === SCREEN_TOTAL);
  // next 100 + eng sekin GET 150 = 250. Ketma-ket bo'lsa 100 + 3 × 150 = 550 (state va
  // queue-summary kechikmaydi); `next` qo'shilmasa — 150.
  assert.ok(screen.p50 >= 240 && screen.p50 < 450, `p50 ${screen.p50}`);
  assert.ok(screen.requests >= 2, `${screen.requests}`);
});

test('QA-04: stend seed qilinmagan (yuklama sahifasi yo‘q) — hech narsa yaratilmaydi', async (t) => {
  const result = await run(
    t,
    ['operators'],
    QUEUE({
      total: 30,
      landing: [
        200,
        { data: { state: 'OPEN', product: { name: 'Haqiqiy mahsulot' } } },
      ],
    }),
    OPERATOR_ENV,
  );
  assert.equal(result.code, 2, result.output);
  assert.match(result.output, /yuklama mahsuloti emas/);
  for (const path of ['/auth/login', '/admin/team', '/operator/leads/next']) {
    assert.ok(!result.requests.some((r) => r.path === path), path);
  }
});

test('QA-04: Ctrl+C — qo‘ldagi sinov lidlari yopiladi, operatorlar OFFLINE, hisobot bor', async (t) => {
  const started = performance.now();
  const result = await run(
    t,
    ['operators'],
    QUEUE({ total: 100_000, nextDelay: 5 }),
    { ...OPERATOR_ENV, LOAD_DURATION_SEC: '60' },
    { killAfterMs: 1500 },
  );
  assert.equal(result.code, 1, result.output);
  assert.ok(performance.now() - started < 15_000);
  const report = result.evidence;
  assert.match(report.failures.join(), /SIGINT bilan to‘xtatildi/);
  assert.ok(report.leadsTaken >= 3);
  const closed = result.requests.filter((r) => r.path.endsWith('/result'));
  assert.equal(closed.length, report.leadsTaken);
  const states = result.requests
    .filter((r) => r.method === 'PUT' && r.path === '/operator/state')
    .map((r) => r.body.state);
  assert.deepEqual(states.slice(-3), ['OFFLINE', 'OFFLINE', 'OFFLINE']);
});

test('QA-04: AUTH_TOKENS_IN_BODY=false — token accessToken cookie’dan olinadi', async (t) => {
  const result = await run(
    t,
    ['operators'],
    QUEUE({ total: 30, cookie: true }),
    OPERATOR_ENV,
  );
  assert.equal(result.code, 0, result.output);
  const next = result.requests.filter((r) => r.path === '/operator/leads/next');
  assert.ok(next.length > 0);
  assert.ok(
    next.every((r) =>
      /^Bearer tok-\+99899100000[1-3]$/.test(r.headers.authorization),
    ),
    next[0].headers.authorization,
  );
});

test('QA-04: navbatda qayta qo‘ng‘iroq yoki lid yetmasa — operator yaratilmaydi', async (t) => {
  for (const [options, pattern] of [
    [{ total: 30, due: 2 }, /2 ta muddati kelgan qayta qo‘ng‘iroq/],
    [{ total: 2 }, /2 ta yangi lid, kamida 3 ta kerak/],
  ]) {
    const result = await run(t, ['operators'], QUEUE(options), OPERATOR_ENV);
    assert.equal(result.code, 2, result.output);
    assert.match(result.output, pattern);
    assert.ok(!result.requests.some((r) => r.path === '/admin/team'));
    assert.ok(!result.requests.some((r) => r.path === '/operator/leads/next'));
  }
});

test('QA-04: tayyorgarlik yarmida to‘xtasa — ONLINE bo‘lganlar OFFLINE qilinadi', async (t) => {
  const result = await run(
    t,
    ['operators'],
    QUEUE({ total: 30, failTeamAt: 3 }),
    OPERATOR_ENV,
  );
  assert.equal(result.code, 2, result.output);
  assert.match(result.output, /Operator \+998991000003 yaratilmadi/);
  const states = result.requests.filter(
    (r) => r.method === 'PUT' && r.path === '/operator/state',
  );
  assert.deepEqual(
    states.map((r) => r.body.state),
    ['ONLINE', 'ONLINE', 'OFFLINE', 'OFFLINE'],
  );
  assert.ok(!result.requests.some((r) => r.path === '/operator/leads/next'));
});

test('QA-04 TC4: bitta lid ikki operatorga tushsa — o‘tmadi', async (t) => {
  const result = await run(
    t,
    ['operators'],
    QUEUE({ total: 30, repeatSecond: true }),
    OPERATOR_ENV,
  );
  assert.equal(result.code, 1, result.output);
  assert.equal(result.evidence.doubleAssignments.length, 1);
  assert.equal(result.evidence.doubleAssignments[0].leadId, '1');
});

test('QA-04: navbatdan sinovniki bo‘lmagan lid chiqsa yopilmaydi va sinov to‘xtaydi', async (t) => {
  const result = await run(
    t,
    ['operators'],
    // 2-lid bir vaqtdagi so'rovda chiqadi: 1- va 3-lidni olgan operatorlar ham to'xtaydi,
    // lekin o'z lidini yopib.
    QUEUE({ total: 30, foreignId: '2' }),
    OPERATOR_ENV,
  );
  assert.equal(result.code, 1, result.output);
  assert.match(
    result.evidence.failures.join(),
    /sinovga tegishli bo‘lmagan lid 2/,
  );
  assert.ok(
    !result.requests.some((r) => r.path === '/operator/leads/2/result'),
  );
  // Begona lid chiqqach yangi lid olinmaydi; olingan sinov lidlari bronda qolmaydi.
  assert.equal(result.evidence.leadsTaken, 3);
  const closed = result.requests.filter((r) => r.path.endsWith('/result'));
  assert.deepEqual(closed.map((r) => r.path).sort(), [
    '/operator/leads/1/result',
    '/operator/leads/3/result',
  ]);
});

test('QA-04: oldingi yugurishdan qolgan operator (409) qayta ishlatiladi; bo‘sh navbat — o‘tmadi', async (t) => {
  const result = await run(
    t,
    ['operators'],
    // Navbat xulosasi 3 ta lid ko'rsatgan, lekin ular boshqa operatorga ketgan (poyga).
    QUEUE({ total: 1, newLeads: 3, exists: true }),
    OPERATOR_ENV,
  );
  assert.equal(result.code, 1, result.output);
  assert.deepEqual(result.evidence.burst, { operators: 3, distinctLeads: 1 });
  assert.match(result.evidence.failures.join(), /1\/3 operator lid oldi/);
  assert.ok(result.evidence.emptyQueueResponses > 0);
  assert.match(result.evidence.failures.join(), /navbat ko‘pincha bo‘sh/);
});
