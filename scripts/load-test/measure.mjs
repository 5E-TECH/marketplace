/**
 * BE-37 / QA-04 yuklama sinovi — o'lchov yadrosi: bitta so'rov vaqti, ochiq sikl va xulosa
 * (p50…p99, xatolar, haqiqiy tezlik). Lid yoki operatorga bog'liq emas.
 */
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function round(value) {
  return value === null ? null : Math.round(value * 10) / 10;
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
export function slim({ ok, status, ms, error }) {
  return error === undefined ? { ok, status, ms } : { ok, status, ms, error };
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

export function progress(label, samples, startedAt) {
  const done = samples.length;
  const errors = samples.filter((s) => !s.ok).length;
  const p95 = percentile(sentLatencies(samples), 95);
  const seconds = Math.round((performance.now() - startedAt) / 1000);
  console.log(
    `[${seconds} s] ${label}: ${done} so‘rov, ${errors} xato, p95 ${round(p95) ?? '-'} ms`,
  );
}
