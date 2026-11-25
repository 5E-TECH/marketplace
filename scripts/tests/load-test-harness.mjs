// BE-37 / QA-04 yuklama vositasi testlari uchun umumiy: soxta server bilan CLI ni ishga
// tushirish va soxta server javoblari. `*.test.mjs` emas — test:ops uni alohida yurgizmaydi.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

// POST /leads DTO (libs/common/src/dto/lead.dto.ts) — forbidNonWhitelisted boshqa maydonga 400 beradi.
export const LEAD_FIELDS = new Set([
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

export async function run(t, args, handler, env = {}, { killAfterMs } = {}) {
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
export const LANDING_OK = `[200, { data: { state: 'OPEN', product: { name: 'Yuklama-sinov mahsulot t1' } } }]`;

export const OPEN_LANDING = `(method, path, body, headers, state) => {
  if (path.startsWith('/landing/')) return ${LANDING_OK};
  state.n = (state.n ?? 0) + 1;
  return [201, { statusCode: 201, data: { leadId: String(state.n), duplicate: false } }];
}`;

// Operator navbati soxta serveri: navbatda `total` ta lid, «keyingi lid» birinchisini beradi.
export const QUEUE = (
  options = {},
) => `(method, path, body, headers, state) => {
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

export const OPERATOR_ENV = {
  LOAD_STREAM_CODE: 'lt1',
  LOAD_ADMIN_PHONE: '+998900000001',
  LOAD_ADMIN_PASSWORD: 'admin-parol',
  LOAD_OPERATOR_PASSWORD: 'operator-parol',
  LOAD_OPERATORS: '3',
  LOAD_OPERATOR_PAUSE_MS: '0',
};
