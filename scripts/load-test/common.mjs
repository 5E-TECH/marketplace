/**
 * BE-37 / QA-04 yuklama sinovi — senariylar uchun umumiy: sinov ma'lumoti (telefon, IP, lid
 * tanasi), so'rov sarlavhalari, login tokeni, to'xtash holati va foydalanish xatosi.
 */

// LEAD_PHONE_OPERATOR_CODES yoqilsa ham o'tadigan kodlar (integratsion testlardagi ro'yxat).
const OPERATOR_CODES = ['90', '91', '93', '94', '95', '97', '98', '99'];
const PHONE_SPACE = OPERATOR_CODES.length * 10_000_000;
// Ikki yugurish telefonlari kesishmasligi uchun: soniyasiga 100 tagacha raqam zaxiralanadi.
export const MAX_RATE = 100;
export const NAME_PREFIX = 'Yuklama-sinov';

export function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export function nonNegativeInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
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
// olinmaydi — preflight.mjs dagi checkForwardedFor() buni sinov boshida aniqlaydi.
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

// Xato namunasi hisobot uchun: javob tanasi va tokenlarsiz.
export function errorExample(sample, label) {
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

export class UsageError extends Error {}

// Ctrl+C / SIGTERM: sinov toza to'xtaydi — yangi lid yuborilmaydi/olinmaydi, operatorlar qo'lidagi
// sinov lidini yopib OFFLINE bo'ladi, hisobot yoziladi. Ikkinchi signal — darhol chiqish.
export const stop = { requested: false, signal: null };

export function json(body) {
  return JSON.stringify(body);
}

export function headers({ ip, token, body } = {}) {
  const result = { 'user-agent': 'elchi-load-test/1 (BE-37)' };
  if (body !== undefined) result['content-type'] = 'application/json';
  if (ip) result['x-forwarded-for'] = ip;
  if (token) result.authorization = `Bearer ${token}`;
  return result;
}
