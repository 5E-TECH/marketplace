/**
 * BE-37 / QA-04 yuklama sinovi — boshlashdan oldingi tekshiruvlar: gateway X-Forwarded-For ni
 * hisobga oladimi va nishon seed qilingan sinov stendimi.
 */
import { headers, ipFor, NAME_PREFIX, UsageError } from './common.mjs';
import { timedRequest } from './measure.mjs';

function responseHeader(sample, name) {
  return sample.headers?.get?.(name) ?? null;
}

// Gateway X-Forwarded-For dagi IP ni req.ip deb olayaptimi? Ikki xil, hali ishlatilmagan IP dan
// so'rov: XFF hisobga olinsa, har biri o'z hisobida birinchi — X-RateLimit-Remaining aniq
// Limit − 1. Bitta IP deb sanalsa (yoki IP da oldingi so'rovlar bo'lsa), kamida bittasida kam.
// Ikki probani bir-biri bilan solishtirish yetmaydi: eski urinish oynadan chiqib ketsa, teng chiqardi.
// 404 javobi ham limitga kiradi — lid yaratilmaydi.
export async function checkForwardedFor(cfg, run) {
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
export async function checkLanding(cfg) {
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
