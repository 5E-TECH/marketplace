// QA-04 TC2/TC4: «operators» senariysi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  findDoubleAssignments,
  SCREEN_TOTAL,
} from '../load-test/operators.mjs';
import { OPERATOR_ENV, QUEUE, run } from './load-test-harness.mjs';

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
