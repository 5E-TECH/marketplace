/**
 * BE-37 TC1, QA-04 TC1: «leads» senariysi — POST /leads ochiq siklda.
 */
import { performance } from 'node:perf_hooks';
import {
  errorExample,
  headers,
  ipFor,
  json,
  leadBody,
  MAX_RATE,
  phoneFor,
  stop,
  UsageError,
} from './common.mjs';
import {
  openLoop,
  progress,
  slim,
  summarize,
  timedRequest,
} from './measure.mjs';
import { checkLanding } from './preflight.mjs';

export async function runLeads(cfg, run) {
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
