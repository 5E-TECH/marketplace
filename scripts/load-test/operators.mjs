/**
 * QA-04 TC2/TC4: «operators» senariysi — bir vaqtdagi «keyingi lid», keyin
 * «keyingi lid → ekran → yopish» sikli.
 */
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { errorExample, headers, json, NAME_PREFIX, stop } from './common.mjs';
import { progress, round, slim, summarize, timedRequest } from './measure.mjs';
import { prepareOperators, setState } from './operator-setup.mjs';

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

export async function runOperators(cfg, run) {
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
    // kelgan qayta qo'ng'iroq sinov operatorida qolib ketardi — operator-setup.mjs dagi checkQueue()
    // ularni boshida taqiqlaydi.)
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
