#!/usr/bin/env node
/**
 * BE-37 / QA-04: yuklama sinovi uchun sotuvchi sahifasi (stream) tayyorlash.
 *
 * Foydalanish:
 *   LOAD_DATABASE_URL=postgresql://... LOAD_ADMIN_PHONE=... LOAD_ADMIN_PASSWORD=... \
 *     node scripts/load-test-seed.mjs [--allow-remote]
 *
 * Admin API orqali: optovik → mahsulot → tasdiq → tavsiya narx → HQ omborga kirim. SQL bilan faqat
 * ikki narsa: variant ID (admin API qaytarmaydi) va lead.stream qatori — API orqali sahifa ochish
 * OTP bilan ro'yxatdan o'tgan sotuvchi va VIDEO kreativ talab qiladi, lid qabul qilish esa ularni
 * tekshirmaydi. Stream sotuvchisi — admin foydalanuvchining o'zi. Viloyat/tuman — GET /regions/tree
 * dagi birinchi tuman (geo kesh bo'sh bo'lsa Elchi'dan sinxronlanadi — lokalda ELCHI_PARTNER_API_URL
 * stubga qaratilgan bo'lishi kerak).
 * Oxirida GET /landing/<kod> OPEN ekani tekshiriladi va load-test.mjs uchun env qatorlari chiqadi.
 * Faqat localhost (API va baza); sinov serverida ataylab — --allow-remote. Prod'da ishlatilmaydi.
 */
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  accessTokenFrom,
  ipFor,
  isLocalUrl,
  NAME_PREFIX,
  timedRequest,
} from './load-test.mjs';

class SeedError extends Error {}

const baseUrl = (
  process.env.LOAD_BASE_URL ?? 'http://localhost:3000/api/v1'
).replace(/\/$/, '');
const databaseUrl = process.env.LOAD_DATABASE_URL;
const allowRemote = process.argv.includes('--allow-remote');
const run = randomInt(36 ** 5)
  .toString(36)
  .padStart(5, '0');
const ip = ipFor(randomInt(0x10000), 3, 1);

function digits(count) {
  return Array.from({ length: count }, () => randomInt(10)).join('');
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

// Baza manzili localhost mi? Parol bo'lishi mumkin — URL xato xabarga tushmaydi. `?host=`
// (libpq) va bo'sh host (PGHOST) haqiqiy serverni ko'rsatishi mumkin — ular lokal hisoblanmaydi.
export function isLocalDatabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new SeedError(
      'LOAD_DATABASE_URL noto‘g‘ri (postgresql://user:parol@localhost:5432/baza)',
    );
  }
  return (
    LOCAL_HOSTS.includes(parsed.hostname) && !parsed.searchParams.has('host')
  );
}

async function api(method, path, { token, body } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await timedRequest(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const code = response.body?.errorCode ?? response.error ?? '';
    const message = Array.isArray(response.body?.message)
      ? response.body.message.join('; ')
      : (response.body?.message ?? '');
    throw new SeedError(
      `${method} ${path} → ${response.status} ${code} ${message}`.trim(),
    );
  }
  return response.body?.data ?? response.body;
}

async function main() {
  for (const key of [
    'LOAD_DATABASE_URL',
    'LOAD_ADMIN_PHONE',
    'LOAD_ADMIN_PASSWORD',
  ]) {
    if (!process.env[key]) throw new SeedError(`${key} kerak`);
  }
  if (
    (!isLocalUrl(baseUrl) || !isLocalDatabaseUrl(databaseUrl)) &&
    !allowRemote
  ) {
    throw new SeedError(
      'API lokal stend (localhost:3000) emas yoki baza localhost emas — sinov stendida (tunnel ham) ataylab bo‘lsa --allow-remote (prod emas).',
    );
  }

  // Token tanada (AUTH_TOKENS_IN_BODY=true) yoki accessToken cookie'da — api() sarlavhalarni
  // qaytarmaydi, shuning uchun to'g'ridan-to'g'ri.
  const login = await timedRequest(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
    body: JSON.stringify({
      phone: process.env.LOAD_ADMIN_PHONE,
      password: process.env.LOAD_ADMIN_PASSWORD,
    }),
  });
  if (!login.ok) {
    throw new SeedError(
      `Admin kira olmadi: POST /auth/login → ${login.status} ${login.body?.errorCode ?? login.error ?? ''}`.trim(),
    );
  }
  if (login.body?.challengeToken) {
    throw new SeedError(
      'Admin akkauntida 2FA yoqilgan — sinov uchun 2FA siz admin kerak',
    );
  }
  const token = accessTokenFrom(login);
  if (!token) {
    throw new SeedError(
      'Admin tokeni kelmadi: na tanada, na accessToken cookie’da',
    );
  }

  const tree = await api('GET', '/regions/tree');
  const region = tree.find((group) => group.districts?.length);
  if (!region) throw new SeedError('GET /regions/tree bo‘sh — geo kesh yo‘q');
  const district = region.districts[0];

  const wholesaler = await api('POST', '/admin/wholesalers', {
    token,
    body: {
      name: `${NAME_PREFIX} optovik ${run}`,
      legalType: 'LEGAL_ENTITY',
      tin: digits(9),
      bankName: 'Sinov banki',
      bankAccount: digits(20),
      bankMfo: digits(5),
      contractNumber: `YS-${run}`,
      contractDate: new Date().toISOString().slice(0, 10),
    },
  });
  const productName = `${NAME_PREFIX} mahsulot ${run}`;
  const product = await api('POST', '/admin/products', {
    token,
    body: {
      wholesalerId: String(wholesaler.id),
      name: productName,
      // Shu bazaviy narxda tizim tavsiya qiladigan sotuvchi haqi (pricing.recommendedAffiliateFee):
      // kichikroq haq reklama xarajatini qoplamaydi va narx «to‘q sariq» bo‘ladi.
      basePrice: 100_000,
      affiliateFee: 65_000,
      weightGrams: 500,
      lengthMm: 200,
      widthMm: 150,
      heightMm: 100,
      imageUrl: 'https://example.com/yuklama-sinov.jpg',
      // BE-41: CPA mahsulotini tasdiqlash uchun fiskal chek kodlari majburiy.
      mxikCode: digits(17),
      packageCode: digits(7),
    },
  });
  const productId = String(product.id);
  await api('POST', `/admin/products/${productId}/approve`, { token });
  const pricing = await api('GET', `/admin/products/${productId}/pricing`, {
    token,
  });
  const price = pricing?.calculation?.recommended;
  if (!Number.isInteger(price)) {
    throw new SeedError('Tavsiya narx hisoblanmadi (pricing.calculation)');
  }
  if (!['GREEN', 'YELLOW'].includes(pricing?.evaluation?.status)) {
    throw new SeedError(
      `Tavsiya narx ${price} holati ${pricing?.evaluation?.status} (GREEN kutilgan) — narx sozlamalari o‘zgarganmi?`,
    );
  }
  await api('POST', `/admin/products/${productId}/price-decision`, {
    token,
    body: { price },
  });

  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    // SQL yozuvidan oldin: baza aynan shu API ning bazasimi (boshqa stend/bazaga lead.stream
    // yozib yubormaslik uchun) — API hozirgina yaratgan mahsulot nomi bazada ham shunday.
    const same = await db
      .query('SELECT name FROM catalog.product WHERE id = $1', [productId])
      .catch((error) => {
        // 42P01 — catalog sxemasi yo'q: bu marketplace bazasi emas.
        throw new SeedError(
          `LOAD_DATABASE_URL boshqa bazaga qaragan: catalog.product o‘qilmadi (${error.code ?? error.message})`,
        );
      });
    if (same.rows[0]?.name !== productName) {
      throw new SeedError(
        `LOAD_DATABASE_URL boshqa bazaga qaragan: mahsulot ${productId} bazada yo‘q yoki nomi boshqa`,
      );
    }
    const variant = await db.query(
      'SELECT id FROM catalog.product_variant WHERE product_id = $1 AND is_active AND NOT is_deleted ORDER BY id LIMIT 1',
      [productId],
    );
    if (!variant.rows[0]) throw new SeedError('Faol variant topilmadi');
    await api('POST', '/admin/inventory/inbound', {
      token,
      body: {
        variantId: String(variant.rows[0].id),
        quantity: 1_000_000,
        reason: 'Yuklama sinovi (BE-37)',
      },
    });
    const admin = await db.query(
      'SELECT id FROM identity.users WHERE phone = $1 AND NOT is_deleted',
      [process.env.LOAD_ADMIN_PHONE],
    );
    if (!admin.rows[0]) throw new SeedError('Admin foydalanuvchi topilmadi');
    const code = `lt${run}`;
    await db.query(
      `INSERT INTO lead.stream (code, affiliate_id, product_id, sale_price, status, sub1)
       VALUES ($1, $2, $3, $4, 'ACTIVE', 'loadtest')`,
      [code, admin.rows[0].id, productId, price],
    );

    const landing = await api('GET', `/landing/${code}`);
    if (landing?.state !== 'OPEN') {
      throw new SeedError(`Sahifa ochilmadi: state ${landing?.state}`);
    }
    console.log(`# BE-37 yuklama sinovi: mahsulot ${productId}, narx ${price}`);
    console.log(`LOAD_STREAM_CODE=${code}`);
    console.log(`LOAD_REGION_SOATO=${region.satoCode}`);
    console.log(`LOAD_DISTRICT_SOATO=${district.satoCode}`);
  } finally {
    await db.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch (error) {
    if (!(error instanceof SeedError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}
