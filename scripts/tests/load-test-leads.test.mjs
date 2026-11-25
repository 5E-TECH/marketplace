// BE-37 TC1, QA-04 TC1: «leads» senariysi va CLI himoyasi (localhost, XFF, seed qilingan
// sahifa, hisobot fayli, foydalanish xatosi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIPv6 } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ipFor, isLocalUrl, leadBody, phoneFor } from '../load-test/common.mjs';
import {
  LANDING_OK,
  LEAD_FIELDS,
  OPEN_LANDING,
  run,
} from './load-test-harness.mjs';

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
