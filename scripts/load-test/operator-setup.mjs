/**
 * QA-04: «operators» senariysi tayyorgarligi — admin login, navbat tekshiruvi, sinov
 * operatorlarini yaratish va ONLINE/OFFLINE qilish.
 */
import {
  accessTokenFrom,
  headers,
  ipFor,
  json,
  NAME_PREFIX,
  stop,
  UsageError,
} from './common.mjs';
import { timedRequest } from './measure.mjs';
import { checkLanding } from './preflight.mjs';

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

export async function setState(cfg, op, state) {
  return timedRequest(`${cfg.baseUrl}/operator/state`, {
    method: 'PUT',
    headers: headers({ ip: op.ip, token: op.token, body: true }),
    body: json({ state }),
    timeoutMs: cfg.timeoutMs,
  });
}

export async function prepareOperators(cfg, run) {
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
