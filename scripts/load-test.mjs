#!/usr/bin/env node
/**
 * BE-37 TC1, QA-04 TC1/TC2/TC4: yuklama sinovi. Tashqi paketsiz (Node 22 fetch).
 *
 * Foydalanish:
 *   LOAD_STREAM_CODE=<kod> node scripts/load-test.mjs leads
 *   LOAD_ADMIN_PHONE=... LOAD_ADMIN_PASSWORD=... LOAD_OPERATOR_PASSWORD=... \
 *     node scripts/load-test.mjs operators
 *   Qo'shimcha: --allow-remote (localhost bo'lmagan manzil), --single-ip
 *
 * --allow-remote faqat api-gateway'ga loopback yoki ichki tarmoqdan ulanganda ishlaydi (ssh
 * tunnel, server ichidan): Cloudflare/Caddy orqali gateway haqiqiy klient IP siga ishonadi va
 * hamma so'rov bitta IP bo'lib qoladi. Boshida buni tekshiradi (X-Forwarded-For sinovi).
 *
 * leads — POST /leads, LOAD_RATE lid/s (10), LOAD_DURATION_SEC (600), p95 < LOAD_P95_MS (300).
 * operators — LOAD_OPERATORS (20) operator: boshida hammasi bir vaqtda «keyingi lid»,
 *   keyin «keyingi lid → kartochka → yopish» sikli; har ekran so'rovi p95 < LOAD_P95_MS (1000),
 *   bitta lid ikki operatorga tushmaydi.
 *
 * So'rovlar "ochiq sikl"da yuboriladi: har lid o'z vaqtida ketadi, oldingi javobni kutmaydi.
 * Kechikish rejalashtirilgan vaqtdan javob tanasi to'liq o'qilguncha o'lchanadi — server
 * sekinlashsa, navbatda turgan vaqt ham hisobga kiradi (coordinated omission yo'q).
 * Hamma sozlama va ishga tushirish tartibi: docs/BE-37-YUKLAMA.md.
 */
import { randomInt } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// LEAD_PHONE_OPERATOR_CODES yoqilsa ham o'tadigan kodlar (integratsion testlardagi ro'yxat).
const OPERATOR_CODES = ['90', '91', '93', '94', '95', '97', '98', '99'];
const PHONE_SPACE = OPERATOR_CODES.length * 10_000_000;
// Ikki yugurish telefonlari kesishmasligi uchun: soniyasiga 100 tagacha raqam zaxiralanadi.
const MAX_RATE = 100;
export const NAME_PREFIX = 'Yuklama-sinov';

export function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function round(value) {
  return value === null ? null : Math.round(value * 10) / 10;
}

// Lid telefoni: +998 + operator kodi + 7 raqam. Ketma-ket lidlar kodlar bo'ylab aylanadi;
// boshlanish nuqtasi yugurish vaqtidan (soniya × MAX_RATE), shuning uchun keyingi
// yugurish oldingisi ishlatgan raqamlarga ~9 kun davomida qaytmaydi (dublikat → MERGED).
export function phoneFor(startSecond, i) {
  const slot = (startSecond * MAX_RATE + i) % PHONE_SPACE;
  const code = OPERATOR_CODES[slot % OPERATOR_CODES.length];
  const number = Math.floor(slot / OPERATOR_CODES.length);
  return `+998${code}${String(number).padStart(7, '0')}`;
}

// Mijoz IP manzili (X-Forwarded-For): hujjatlar uchun ajratilgan 2001:db8::/32 dan, har
// lidga alohida. Gateway trust-proxy faqat loopback/ichki tarmoqdan kelgan XFF ga ishonadi
// (trust-proxy.ts): shunda req.ip shu bo'ladi va 300/min per IP limiti hamda 5 lid/IP/10 daqiqa
// (IP_RATE) qoidasi har lidni alohida mijoz deb ko'radi. Public domen orqali XFF hisobga
// olinmaydi — checkForwardedFor() buni sinov boshida aniqlaydi.
export function ipFor(run, group, i) {
  const hex = (n) => (n & 0xffff).toString(16);
  return `2001:db8:${hex(run)}:${hex(group)}::${hex(i >>> 16)}:${hex(i)}`;
}

export function leadBody({
  code,
  runId,
  i,
  phone,
  regionSoato,
  districtSoato,
}) {
  return {
    code,
    name: `${NAME_PREFIX} ${runId}-${i}`,
    phone,
    regionSoato,
    districtSoato,
    addressLine: 'Yuklama ko‘chasi, 1-uy',
    whereDeliver: 'CENTER',
    consentVersion: 'yuklama-sinov',
    variant: i % 2 === 0 ? 's1' : 's3',
    sub1: `loadtest-${runId}`,
    utmSource: 'loadtest',
  };
}

// Kechikishga yuborilgan har so'rov kiradi — timeout va tarmoq xatosi ham (o'lchangan vaqti bilan,
// aks holda dum yashirinardi); faqat overload — umuman yuborilmagan — kirmaydi.
function sentLatencies(samples) {
  return samples.filter((s) => s.error !== 'overload').map((s) => s.ms);
}

export function summarize(
  name,
  samples,
  { p95Ms, durationMs, rate, windowMs = durationMs },
) {
  const latencies = sentLatencies(samples);
  const errors = samples.filter((s) => !s.ok);
  const byStatus = {};
  for (const sample of errors) {
    const key = sample.error ?? String(sample.status);
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }
  const p95 = percentile(latencies, 95);
  const expected =
    rate === undefined ? null : Math.floor((rate * durationMs) / 1000);
  const failures = [];
  if (samples.length === 0) failures.push('birorta so‘rov bajarilmadi');
  if (errors.length > 0) failures.push(`${errors.length} ta xato`);
  if (p95 !== null && p95 >= p95Ms) {
    failures.push(`p95 ${round(p95)} ms ≥ ${p95Ms} ms`);
  }
  if (expected !== null && samples.length < expected) {
    failures.push(`${samples.length}/${expected} so‘rov yuborildi`);
  }
  return {
    name,
    requests: samples.length,
    expected,
    errors: errors.length,
    errorsByStatus: byStatus,
    // Haqiqatda yuborilganlar (overload — yuborilmagan) yuborish oynasiga bo'linadi.
    achievedRate: round(
      samples.filter((s) => s.error !== 'overload').length / (windowMs / 1000),
    ),
    p50: round(percentile(latencies, 50)),
    p90: round(percentile(latencies, 90)),
    p95: round(p95),
    p99: round(percentile(latencies, 99)),
    // Math.max(...) ~125 000 dan ortiq elementda stekni to'ldiradi.
    max: round(
      latencies.length
        ? latencies.reduce((a, b) => (b > a ? b : a), latencies[0])
        : null,
    ),
    p95LimitMs: p95Ms,
    passed: failures.length === 0,
    failures,
  };
}

// Bitta HTTP so'rov: javob tanasi to'liq o'qilgunga qadar vaqt. Tana va sarlavhalar qaytariladi
// (chaqiruvchi tekshiradi), lekin namunalarga slim() orqali faqat ok/status/ms/error tushadi.
export async function timedRequest(
  url,
  { scheduledAt, timeoutMs = 10_000, ...options } = {},
) {
  const start = scheduledAt ?? performance.now();
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      ms: performance.now() - start,
      body,
      headers: response.headers,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: performance.now() - start,
      error:
        error?.name === 'TimeoutError'
          ? 'timeout'
          : String(error?.cause?.code ?? error?.name ?? 'network'),
    };
  }
}

// O'lchov namunasi: tana va sarlavhalarsiz (tokenlar, cookie'lar xotirada ham to'planmaydi).
function slim({ ok, status, ms, error }) {
  return error === undefined ? { ok, status, ms } : { ok, status, ms, error };
}

function responseHeader(sample, name) {
  return sample.headers?.get?.(name) ?? null;
}

// Login tokeni: AUTH_TOKENS_IN_BODY=true bo'lsa tanada, aks holda (prod sukuti) faqat
// `accessToken` cookie'da (libs/common/src/auth/auth-cookies.ts).
export function accessTokenFrom(sample) {
  if (typeof sample.body?.accessToken === 'string' && sample.body.accessToken) {
    return sample.body.accessToken;
  }
  for (const cookie of sample.headers?.getSetCookie?.() ?? []) {
    const match = /^accessToken=([^;]+)/.exec(cookie);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

// Ochiq sikl: i-so'rov start + i/rate da yuboriladi. Bir vaqtda ochiq so'rovlar
// maxInflight ga yetsa, yangisi yuborilmaydi va "overload" xatosi yoziladi — server
// bardosh berolmayapti, kutib turish esa o'lchovni yashirardi.
export async function openLoop({
  rate,
  durationMs,
  maxInflight,
  task,
  samples = [],
  shouldStop = () => false,
}) {
  const interval = 1000 / rate;
  const total = Math.floor((rate * durationMs) / 1000);
  const start = performance.now();
  const pending = new Set();
  let lastSentAt = start;
  for (let i = 0; i < total; i += 1) {
    const scheduledAt = start + i * interval;
    // Taymer keshlangan loop vaqtidan hisoblanadi va yuklama ostida erta uyg'onishi mumkin:
    // rejadan oldin yuborilsa, kechikish kam o'lchanardi — reja kelguncha qayta kutamiz.
    for (
      let wait = scheduledAt - performance.now();
      wait > 0;
      wait = scheduledAt - performance.now()
    ) {
      if (shouldStop()) break;
      await sleep(wait);
    }
    if (shouldStop()) break;
    if (pending.size >= maxInflight) {
      samples.push({ ok: false, status: 0, ms: 0, error: 'overload' });
      continue;
    }
    lastSentAt = performance.now();
    const promise = task(i, scheduledAt).then((sample) => {
      samples.push(sample);
      pending.delete(promise);
    });
    pending.add(promise);
  }
  await Promise.all(pending);
  // sendWindowMs — oxirgi so'rov yuborilgan paytgacha (+ bitta oraliq): event loop
  // kechiksa, haqiqiy tezlik rejadagidan past chiqadi.
  return {
    samples,
    elapsedMs: performance.now() - start,
    sendWindowMs: lastSentAt - start + interval,
  };
}

// Xato namunasi hisobot uchun: javob tanasi va tokenlarsiz.
function errorExample(sample, label) {
  return {
    label,
    status: sample.status,
    error: sample.error ?? null,
    errorCode: sample.body?.errorCode ?? null,
    requestId: sample.body?.requestId ?? null,
  };
}

// Lokal stend — faqat loopback va 3000-port. Boshqa lokal port ko'pincha ssh tunnel (masalan
// prod Swagger tunneli 13000 da, C4.6-RUNBOOK) — u --allow-remote talab qiladi.
export function isLocalUrl(url) {
  const { hostname, port } = new URL(url);
  return (
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname) &&
    port === '3000'
  );
}

function config(env = process.env) {
  const scenario = process.argv[2];
  const flags = new Set(process.argv.slice(3));
  const baseUrl = (env.LOAD_BASE_URL ?? 'http://localhost:3000/api/v1').replace(
    /\/$/,
    '',
  );
  return {
    scenario,
    allowRemote: flags.has('--allow-remote'),
    singleIp: flags.has('--single-ip'),
    unknownFlags: [...flags].filter(
      (f) => !['--allow-remote', '--single-ip'].includes(f),
    ),
    baseUrl,
    durationMs: positiveInt(env.LOAD_DURATION_SEC, 600) * 1000,
    rate: positiveInt(env.LOAD_RATE, 10),
    p95Ms: positiveInt(env.LOAD_P95_MS, scenario === 'operators' ? 1000 : 300),
    maxInflight: positiveInt(env.LOAD_MAX_INFLIGHT, 200),
    timeoutMs: positiveInt(env.LOAD_TIMEOUT_MS, 10_000),
    reportFile: env.LOAD_REPORT_FILE,
    streamCode: env.LOAD_STREAM_CODE,
    regionSoato: env.LOAD_REGION_SOATO ?? '1726',
    districtSoato: env.LOAD_DISTRICT_SOATO ?? '1726266',
    operators: positiveInt(env.LOAD_OPERATORS, 20),
    operatorPauseMs: nonNegativeInt(env.LOAD_OPERATOR_PAUSE_MS, 1000),
    operatorPhonePrefix: env.LOAD_OPERATOR_PHONE_PREFIX ?? '+998991000',
    adminPhone: env.LOAD_ADMIN_PHONE,
    adminPassword: env.LOAD_ADMIN_PASSWORD,
    operatorPassword: env.LOAD_OPERATOR_PASSWORD,
  };
}

class UsageError extends Error {}

// Ctrl+C / SIGTERM: sinov toza to'xtaydi — yangi lid yuborilmaydi/olinmaydi, operatorlar qo'lidagi
// sinov lidini yopib OFFLINE bo'ladi, hisobot yoziladi. Ikkinchi signal — darhol chiqish.
const stop = { requested: false, signal: null };

function json(body) {
  return JSON.stringify(body);
}

function headers({ ip, token, body } = {}) {
  const result = { 'user-agent': 'elchi-load-test/1 (BE-37)' };
  if (body !== undefined) result['content-type'] = 'application/json';
  if (ip) result['x-forwarded-for'] = ip;
  if (token) result.authorization = `Bearer ${token}`;
  return result;
}

function progress(label, samples, startedAt) {
  const done = samples.length;
  const errors = samples.filter((s) => !s.ok).length;
  const p95 = percentile(sentLatencies(samples), 95);
  const seconds = Math.round((performance.now() - startedAt) / 1000);
  console.log(
    `[${seconds} s] ${label}: ${done} so‘rov, ${errors} xato, p95 ${round(p95) ?? '-'} ms`,
  );
}

// Gateway X-Forwarded-For dagi IP ni req.ip deb olayaptimi? Ikki xil, hali ishlatilmagan IP dan
// so'rov: XFF hisobga olinsa, har biri o'z hisobida birinchi — X-RateLimit-Remaining aniq
// Limit − 1. Bitta IP deb sanalsa (yoki IP da oldingi so'rovlar bo'lsa), kamida bittasida kam.
// Ikki probani bir-biri bilan solishtirish yetmaydi: eski urinish oynadan chiqib ketsa, teng chiqardi.
// 404 javobi ham limitga kiradi — lid yaratilmaydi.
async function checkForwardedFor(cfg, run) {
  const probe = (n) =>
    timedRequest(`${cfg.baseUrl}/landing/xff-probe`, {
      headers: headers({ ip: ipFor(run.num, 4, n) }),
      timeoutMs: cfg.timeoutMs,
    });
  const first = await probe(1);
  if (first.status === 0) {
    throw new UsageError(`${cfg.baseUrl} javob bermadi: ${first.error}`);
  }
  const second = await probe(2);
  const read = (sample, name) =>
    Number(responseHeader(sample, name) ?? Number.NaN);
  const probes = [first, second].map((sample) => ({
    limit: read(sample, 'x-ratelimit-limit'),
    left: read(sample, 'x-ratelimit-remaining'),
  }));
  if (!probes.every((p) => Number.isFinite(p.limit + p.left))) {
    throw new UsageError(
      `${cfg.baseUrl}: X-RateLimit-Limit/Remaining sarlavhasi yo‘q — bu manzil api-gateway emasmi?`,
    );
  }
  if (probes.some((p) => p.left !== p.limit - 1)) {
    throw new UsageError(
      'Gateway X-Forwarded-For ni hisobga olmayapti: hamma so‘rov bitta IP dan sanaladi, ' +
        '300/min limiti va IP_RATE butun sinovni buzadi. Gateway’ga loopback yoki ichki ' +
        'tarmoqdan ulaning (ssh tunnel yoki server ichidan, docs/BE-37-YUKLAMA.md), ' +
        'Cloudflare/Caddy orqali emas.',
    );
  }
}

// Ikkala senariy uchun ham: stend seed qilingan (yuklama sahifasi bor va OPEN). leads uchun —
// lidlar shu sahifaga ketadi; operators uchun — nishon haqiqatan sinov stendi ekanining belgisi
// (prod'da `Yuklama-sinov` mahsuloti yo'q), birorta operator yaratilishidan oldin.
async function checkLanding(cfg) {
  if (!cfg.streamCode) throw new UsageError('LOAD_STREAM_CODE kerak');
  const landing = await timedRequest(
    `${cfg.baseUrl}/landing/${encodeURIComponent(cfg.streamCode)}`,
    { headers: headers(), timeoutMs: cfg.timeoutMs },
  );
  const state = landing.body?.data?.state;
  if (landing.status !== 200 || state !== 'OPEN') {
    throw new UsageError(
      `Sahifa ochiq emas: GET /landing/${cfg.streamCode} → ${landing.status} ${state ?? landing.body?.errorCode ?? ''}`.trim(),
    );
  }
  // Noto'g'ri kod haqiqiy mahsulotga minglab lid yozib yuborardi: faqat seed yaratgan mahsulot.
  const productName = String(landing.body?.data?.product?.name ?? '');
  if (!productName.startsWith(NAME_PREFIX)) {
    throw new UsageError(
      `${cfg.streamCode} — yuklama mahsuloti emas (nomi «${NAME_PREFIX}» bilan boshlanmaydi). ` +
        'LOAD_STREAM_CODE ni scripts/load-test-seed.mjs chiqargan koddan oling.',
    );
  }
}

async function runLeads(cfg, run) {
  if (!cfg.streamCode) throw new UsageError('LOAD_STREAM_CODE kerak');
  if (cfg.rate > MAX_RATE) throw new UsageError(`LOAD_RATE ≤ ${MAX_RATE}`);
  await checkLanding(cfg);

  const startSecond = Math.floor(Date.now() / 1000);
  const samples = [];
  const examples = [];
  const leadIds = new Set();
  const startedAt = performance.now();
  const timer = setInterval(
    () => progress('leads', samples, startedAt),
    10_000,
  );
  let loop;
  try {
    loop = await openLoop({
      rate: cfg.rate,
      durationMs: cfg.durationMs,
      maxInflight: cfg.maxInflight,
      samples,
      shouldStop: () => stop.requested,
      task: async (i, scheduledAt) => {
        const body = leadBody({
          code: cfg.streamCode,
          runId: run.id,
          i,
          phone: phoneFor(startSecond, i),
          regionSoato: cfg.regionSoato,
          districtSoato: cfg.districtSoato,
        });
        const sample = await timedRequest(`${cfg.baseUrl}/leads`, {
          method: 'POST',
          headers: headers({
            ip: cfg.singleIp ? ipFor(run.num, 0, 0) : ipFor(run.num, 0, i),
            body,
          }),
          body: json(body),
          scheduledAt,
          timeoutMs: cfg.timeoutMs,
        });
        const data = sample.body?.data;
        if (sample.status === 201 && data?.leadId === '0') {
          sample.ok = false;
          sample.error = 'honeypot';
        } else if (sample.status === 201 && data?.duplicate !== false) {
          sample.ok = false;
          sample.error = 'duplicate';
        } else if (sample.ok) {
          leadIds.add(data?.leadId);
        }
        if (!sample.ok && examples.length < 5) {
          examples.push(errorExample(sample, 'POST /leads'));
        }
        return slim(sample);
      },
    });
  } finally {
    clearInterval(timer);
  }
  const summary = summarize('POST /leads', samples, {
    p95Ms: cfg.p95Ms,
    durationMs: cfg.durationMs,
    rate: cfg.rate,
    windowMs: loop.sendWindowMs,
  });
  if (summary.errors === 0 && leadIds.size !== summary.requests) {
    summary.passed = false;
    summary.failures.push(
      `${leadIds.size} ta noyob leadId, ${summary.requests} ta javob`,
    );
  }
  // IP_RATE ushlagan lid ham 201 qaytaradi — bitta IP rejimida API «o'tdi» desa ham, aslida
  // 6-liddan boshlab navbatga tushmagan. Bu rejim faqat namoyish, dalil emas.
  if (cfg.singleIp) {
    summary.passed = false;
    summary.failures.push(
      '--single-ip: namoyish rejimi — IP_RATE ni API ko‘rsatmaydi, natija bazada (3-bo‘lim)',
    );
  }
  if (stop.requested) {
    summary.passed = false;
    summary.failures.push(`${stop.signal} bilan to‘xtatildi`);
  }
  return {
    passed: summary.passed,
    results: [summary],
    leads: { created: leadIds.size, sub1: `loadtest-${run.id}` },
    errorExamples: examples,
  };
}

async function login(cfg, phone, password, ip) {
  const response = await timedRequest(`${cfg.baseUrl}/auth/login`, {
    method: 'POST',
    headers: headers({ ip, body: true }),
    body: json({ phone, password }),
    timeoutMs: cfg.timeoutMs,
  });
  if (response.ok && response.body?.challengeToken) {
    throw new UsageError(
      `${phone} kira olmadi: 2FA yoqilgan — sinov akkauntida 2FA bo‘lmasligi kerak`,
    );
  }
  if (!response.ok) {
    const code = response.body?.errorCode ?? response.error;
    throw new UsageError(
      `${phone} kira olmadi: POST /auth/login → ${response.status}${code ? ` ${code}` : ''}`,
    );
  }
  const token = accessTokenFrom(response);
  if (!token) {
    throw new UsageError(
      `${phone}: POST /auth/login → ${response.status}, lekin token na tanada, na accessToken cookie’da`,
    );
  }
  return token;
}

// Sinov navbatdan «keyingi lid» oladi: muddati kelgan qayta qo'ng'iroq yoki boshqa bron bo'lsa,
// ularni ham tortib olardi (qayta qo'ng'iroq bron tugagach sinov operatorida qolib ketadi).
// Shuning uchun navbatda faqat yangi lidlar bo'lishi kerak — aks holda boshlanmaydi.
async function checkQueue(cfg, token, ip) {
  const response = await timedRequest(`${cfg.baseUrl}/operator/queue-summary`, {
    headers: headers({ ip, token }),
    timeoutMs: cfg.timeoutMs,
  });
  const summary = response.body?.data;
  if (!response.ok || typeof summary?.newLeads !== 'number') {
    throw new UsageError(
      `Navbat holati olinmadi: GET /operator/queue-summary → ${response.status}`,
    );
  }
  if (summary.dueCallbacks > 0 || summary.booked > 0) {
    throw new UsageError(
      `Navbat sinov uchun bo‘sh emas: ${summary.dueCallbacks} ta muddati kelgan qayta qo‘ng‘iroq, ` +
        `${summary.booked} ta bron. Sinov ularni ham olib qo‘yardi. Bron 10 daqiqada tushadi; ` +
        'qayta qo‘ng‘iroqlar bo‘lsa — sinovni alohida bazada o‘tkazing.',
    );
  }
  if (summary.newLeads < cfg.operators) {
    throw new UsageError(
      `Navbatda ${summary.newLeads} ta yangi lid, kamida ${cfg.operators} ta kerak — ` +
        'avval «leads» senariysini ishga tushiring.',
    );
  }
  return summary;
}

async function setState(cfg, op, state) {
  return timedRequest(`${cfg.baseUrl}/operator/state`, {
    method: 'PUT',
    headers: headers({ ip: op.ip, token: op.token, body: true }),
    body: json({ state }),
    timeoutMs: cfg.timeoutMs,
  });
}

async function prepareOperators(cfg, run) {
  for (const key of [
    'LOAD_ADMIN_PHONE',
    'LOAD_ADMIN_PASSWORD',
    'LOAD_OPERATOR_PASSWORD',
  ]) {
    if (!process.env[key]) throw new UsageError(`${key} kerak`);
  }
  if (cfg.operators > 999) throw new UsageError('LOAD_OPERATORS ≤ 999');
  await checkLanding(cfg);
  const adminIp = ipFor(run.num, 2, 0);
  const adminToken = await login(
    cfg,
    cfg.adminPhone,
    cfg.adminPassword,
    adminIp,
  );
  const queue = await checkQueue(cfg, adminToken, adminIp);
  const operators = [];
  try {
    for (let n = 1; n <= cfg.operators; n += 1) {
      if (stop.requested)
        throw new UsageError(`${stop.signal} bilan to‘xtatildi`);
      const phone = `${cfg.operatorPhonePrefix}${String(n).padStart(3, '0')}`;
      const body = {
        name: `${NAME_PREFIX} operator ${n}`,
        phone,
        role: 'OPERATOR_LEAD',
        password: cfg.operatorPassword,
      };
      const created = await timedRequest(`${cfg.baseUrl}/admin/team`, {
        method: 'POST',
        headers: headers({ ip: adminIp, token: adminToken, body }),
        body: json(body),
        timeoutMs: cfg.timeoutMs,
      });
      // 409 — operator oldingi yugurishdan bor; o'sha parol bilan kiramiz.
      if (!created.ok && created.status !== 409) {
        throw new UsageError(
          `Operator ${phone} yaratilmadi: POST /admin/team → ${created.status}`,
        );
      }
      // Login 5/min per IP: har operatorga o'z IP si (keyingi so'rovlari ham shu IP dan).
      const ip = ipFor(run.num, 1, n);
      const token = await login(cfg, phone, cfg.operatorPassword, ip);
      const op = { n, phone, ip, token };
      const online = await setState(cfg, op, 'ONLINE');
      if (!online.ok) {
        throw new UsageError(
          `Operator ${phone} ONLINE bo‘lmadi: PUT /operator/state → ${online.status}`,
        );
      }
      operators.push(op);
    }
  } catch (error) {
    // Tayyorgarlik yarmida to'xtasa, ONLINE bo'lib ulgurganlar ONLINE qolib ketmasin.
    await Promise.all(operators.map((op) => setState(cfg, op, 'OFFLINE')));
    throw error;
  }
  return { operators, queue };
}

// Operator ekrani (FE-08) lid olganda ochadigan so'rovlar. «Keyingi lid» javobining
// o'zi kartochka (LeadCardDto) — TC2 «lid kartasi 1 s da ochiladi» shu so'rov.
const SCREEN = [
  ['GET /operator/leads/:id', (id) => `/operator/leads/${id}`],
  ['GET /operator/leads/:id/product', (id) => `/operator/leads/${id}/product`],
  ['GET /operator/leads', () => '/operator/leads'],
  ['GET /operator/state', () => '/operator/state'],
  ['GET /operator/queue-summary', () => '/operator/queue-summary'],
];
// Butun ekran (TC2): SPA kartochkani olgach 5 ta GET ni birdaniga yuboradi — ekran eng
// sekini kelganda tayyor. Shuning uchun: «keyingi lid» + eng sekin GET.
export const SCREEN_TOTAL = 'ekran: keyingi lid + 5 GET (parallel)';

export function findDoubleAssignments(assignments) {
  const owners = new Map();
  for (const { leadId, operator } of assignments) {
    owners.set(leadId, [...(owners.get(leadId) ?? []), operator]);
  }
  return [...owners]
    .filter(([, list]) => list.length > 1)
    .map(([leadId, list]) => ({ leadId, operators: list }));
}

async function runOperators(cfg, run) {
  const { operators, queue } = await prepareOperators(cfg, run);
  const byName = new Map();
  const record = (name, sample) => {
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(sample);
  };
  const assignments = [];
  const examples = [];
  let foreign = null;
  let emptyQueue = 0;
  let firstEmptyAt = null;
  const runStart = performance.now();
  const deadline = performance.now() + cfg.durationMs;

  const call = (op, path, init = {}) =>
    timedRequest(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: headers({ ip: op.ip, token: op.token, body: init.body }),
      timeoutMs: cfg.timeoutMs,
    });
  const keep = (name, sample) => {
    if (!sample.ok && examples.length < 5) {
      examples.push(errorExample(sample, name));
    }
    record(name, slim(sample));
    return sample.body;
  };

  const takeNext = async (op) => {
    const sample = await call(op, '/operator/leads/next', { method: 'POST' });
    if (
      sample.status === 404 &&
      sample.body?.errorCode === 'LEAD_QUEUE_EMPTY'
    ) {
      emptyQueue += 1;
      firstEmptyAt ??= performance.now();
      return null;
    }
    const card = keep('POST /operator/leads/next', sample)?.data;
    if (!sample.ok || !card?.id) return null;
    assignments.push({ leadId: card.id, operator: op.n });
    // Sinov faqat o'zi yaratgan lidlarni yopadi. Boshqasi kelsa — yopilmaydi va hamma operator
    // to'xtaydi: yangi lid bron muddati (10 daqiqa) tugagach o'zi navbatga qaytadi. (Muddati
    // kelgan qayta qo'ng'iroq sinov operatorida qolib ketardi — checkQueue() ularni boshida taqiqlaydi.)
    if (!String(card.customerName ?? '').startsWith(NAME_PREFIX)) {
      foreign ??= { leadId: card.id, operator: op.n };
      return null;
    }
    return { id: card.id, ms: sample.ms };
  };

  const openScreen = async (op, lead) => {
    const screen = await Promise.all(
      SCREEN.map(async ([name, path]) => {
        const sample = await call(op, path(lead.id));
        keep(name, sample);
        return { name, sample };
      }),
    );
    const failed = screen.find((s) => !s.sample.ok);
    const total = lead.ms + Math.max(...screen.map((s) => s.sample.ms));
    record(
      SCREEN_TOTAL,
      failed
        ? {
            ok: false,
            status: failed.sample.status,
            ms: total,
            error: `${failed.name} → ${failed.sample.error ?? failed.sample.status}`,
          }
        : { ok: true, status: 200, ms: total },
    );
  };

  const work = async (op, first) => {
    let lead = first;
    for (;;) {
      // O'zi olgan sinov lidini har doim yopadi — boshqa operator begona lid topgan bo'lsa ham.
      if (lead) {
        await openScreen(op, lead);
        const closed = await call(op, `/operator/leads/${lead.id}/result`, {
          method: 'POST',
          body: json({ outcome: 'INVALID', comment: 'Yuklama sinovi' }),
        });
        keep('POST /operator/leads/:id/result', closed);
      }
      const done = () =>
        foreign || stop.requested || performance.now() >= deadline;
      if (done()) return;
      await sleep(lead ? cfg.operatorPauseMs : 1000);
      if (done()) return;
      lead = await takeNext(op);
    }
  };

  // TC4: hamma operator «keyingi lid» ni bir vaqtda bosadi.
  const burst = await Promise.all(operators.map((op) => takeNext(op)));
  const burstIds = burst.filter(Boolean).map((lead) => lead.id);
  const startedAt = performance.now();
  const timer = setInterval(() => {
    const all = [...byName.values()].flat();
    progress('operators', all, startedAt);
  }, 10_000);
  let offline;
  try {
    await Promise.all(operators.map((op, i) => work(op, burst[i])));
  } finally {
    clearInterval(timer);
    // Sinov operatorlari ONLINE bo'lib qolmasin (navbat xulosasi va supervizor ekrani).
    offline = await Promise.all(
      operators.map((op) => setState(cfg, op, 'OFFLINE')),
    );
  }

  const durationMs = Math.max(performance.now() - startedAt, 1);
  const results = [...byName].map(([name, samples]) =>
    summarize(name, samples, { p95Ms: cfg.p95Ms, durationMs }),
  );
  const doubles = findDoubleAssignments(assignments);
  const failures = [];
  if (burstIds.length !== operators.length) {
    failures.push(
      `bir vaqtdagi so‘rovda ${burstIds.length}/${operators.length} operator lid oldi (navbatda yetarli lid yo‘q?)`,
    );
  }
  if (doubles.length > 0) {
    failures.push(`${doubles.length} ta lid ikki operatorga tushdi`);
  }
  if (foreign) {
    failures.push(
      `navbatdan sinovga tegishli bo‘lmagan lid ${foreign.leadId} chiqdi — to‘xtatildi`,
    );
  }
  if (emptyQueue > assignments.length) {
    failures.push(
      `navbat ko‘pincha bo‘sh edi: ${emptyQueue} marta «navbat bo‘sh», ${assignments.length} ta lid — ` +
        'operatorlar yuklamasiz turdi, navbatga ko‘proq lid qo‘ying',
    );
  }
  if (stop.requested) failures.push(`${stop.signal} bilan to‘xtatildi`);
  const notOffline = offline.filter((sample) => !sample.ok).length;
  if (notOffline > 0) {
    failures.push(`${notOffline} ta operator OFFLINE bo‘lmadi`);
  }
  for (const result of results) {
    if (!result.passed)
      failures.push(`${result.name}: ${result.failures.join(', ')}`);
  }
  return {
    passed: failures.length === 0,
    failures,
    results,
    operators: operators.length,
    queueAtStart: { newLeads: queue.newLeads },
    leadsTaken: assignments.length,
    burst: {
      operators: operators.length,
      distinctLeads: new Set(burstIds).size,
    },
    doubleAssignments: doubles,
    emptyQueueResponses: emptyQueue,
    // Navbat birinchi marta qachon bo'shadi (sinov boshidan): undan keyin operatorlar yuklamasiz.
    queueFirstEmptyAtSec:
      firstEmptyAt === null ? null : round((firstEmptyAt - runStart) / 1000),
    errorExamples: examples,
  };
}

// Hisobot fayli yo'li noto'g'ri bo'lsa, 10 daqiqalik sinovdan keyin emas, boshida bilinsin.
async function prepareReportFile(file) {
  try {
    await writeFile(file, '', { flag: 'a', mode: 0o600 });
  } catch (error) {
    throw new UsageError(
      `LOAD_REPORT_FILE ga yozib bo‘lmaydi: ${error.code ?? error.message}`,
    );
  }
}

export async function main() {
  const cfg = config();
  const usage =
    'Foydalanish: node scripts/load-test.mjs leads|operators [--allow-remote] [--single-ip]';
  const run = {
    id: `${Date.now().toString(36)}${randomInt(36 ** 2).toString(36)}`,
    num: randomInt(0x10000),
  };
  const startedAt = new Date().toISOString();
  const onSignal = (signal) => {
    if (stop.requested) process.exit(130);
    stop.requested = true;
    stop.signal = signal;
    console.error(
      `${signal}: to‘xtatilmoqda — qo‘ldagi sinov lidlari yopiladi, operatorlar OFFLINE, ` +
        'hisobot yoziladi. Darhol chiqish uchun — yana bir marta.',
    );
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  let outcome;
  try {
    if (
      !['leads', 'operators'].includes(cfg.scenario) ||
      cfg.unknownFlags.length
    ) {
      throw new UsageError(usage);
    }
    if (!isLocalUrl(cfg.baseUrl) && !cfg.allowRemote) {
      throw new UsageError(
        `${cfg.baseUrl} lokal stend (localhost:3000) emas. Sinov haqiqiy lid va operatorlar ` +
          'yaratadi — sinov stendida (tunnel ham) ataylab ishga tushirilsa --allow-remote ' +
          'qo‘shing (prod emas).',
      );
    }
    if (cfg.reportFile) await prepareReportFile(cfg.reportFile);
    console.log(
      `Yuklama sinovi ${cfg.scenario}: ${cfg.baseUrl}, ${cfg.durationMs / 1000} s` +
        (cfg.scenario === 'leads'
          ? `, ${cfg.rate} lid/s`
          : `, ${cfg.operators} operator`) +
        `, p95 < ${cfg.p95Ms} ms, run ${run.id}`,
    );
    await checkForwardedFor(cfg, run);
    if (stop.requested)
      throw new UsageError(`${stop.signal} bilan to‘xtatildi`);
    outcome =
      cfg.scenario === 'leads'
        ? await runLeads(cfg, run)
        : await runOperators(cfg, run);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  const report = {
    scenario: cfg.scenario,
    runId: run.id,
    baseUrl: cfg.baseUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationSec: cfg.durationMs / 1000,
    rate: cfg.scenario === 'leads' ? cfg.rate : null,
    singleIp: cfg.singleIp,
    ...outcome,
  };
  console.log(JSON.stringify(report, null, 2));
  if (cfg.reportFile) {
    await writeFile(cfg.reportFile, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  console.log(report.passed ? 'NATIJA: o‘tdi' : 'NATIJA: o‘tmadi');
  if (!report.passed) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
