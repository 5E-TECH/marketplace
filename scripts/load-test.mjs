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
 *
 * Bu fayl — faqat CLI (sozlama, himoya, hisobot). Qolgani scripts/load-test/ da:
 *   measure.mjs — o'lchov yadrosi (so'rov vaqti, ochiq sikl, xulosa);
 *   common.mjs — telefon/IP/lid tanasi, sarlavhalar, token, to'xtash holati;
 *   preflight.mjs — XFF va seed qilingan sahifa tekshiruvi;
 *   leads.mjs, operators.mjs (+ operator-setup.mjs) — senariylar.
 */
import { randomInt } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  isLocalUrl,
  nonNegativeInt,
  positiveInt,
  stop,
  UsageError,
} from './load-test/common.mjs';
import { runLeads } from './load-test/leads.mjs';
import { runOperators } from './load-test/operators.mjs';
import { checkForwardedFor } from './load-test/preflight.mjs';

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
