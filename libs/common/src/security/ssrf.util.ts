import { BlockList, isIP } from 'net';
import { lookup } from 'dns/promises';

/**
 * SSRF himoyasi — tashqi URL'ga so'rov yuborishdan oldin (webhook, provider callback, postback)
 * uning ichki/xususiy tarmoqqa ishora qilmasligini tekshiradi.
 * Faqat http/https, va host xususiy IP/localhost bo'lmasligi kerak.
 */
const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1|0\.0\.0\.0)/i;
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[0-1])\./; // 172.16.0.0 – 172.31.255.255

/**
 * BE-14: IP manzil sifatida yozilgan host va DNS javobi uchun ichki tarmoqlar ro'yxati
 * (IPv4 va IPv6, IPv4-mapped IPv6 ham).
 */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 4],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv6');

/** IP ichki tarmoqqa tegishlimi (IPv4-mapped IPv6 — `::ffff:10.0.0.1` — ham tekshiriladi). */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPrivateAddress(mapped[1]);
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family === 6) return BLOCKED.check(address, 'ipv6');
  return false;
}

export function assertSafeUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('URL formati xato');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Faqat http/https ruxsat etiladi');
  }
  const host = url.hostname;
  // IPv6 manzil URL'da qavs ichida keladi: `[::1]`
  const bare =
    host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (
    PRIVATE_HOST.test(host) ||
    PRIVATE_172.test(host) ||
    isPrivateAddress(bare)
  ) {
    throw new Error("Ichki/xususiy manzilga so'rov taqiqlangan (SSRF)");
  }
  return url;
}

export function isSafeUrl(rawUrl: string): boolean {
  try {
    assertSafeUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * BE-14: host DNS orqali ochilib, har manzil tekshiriladi (tashqi domen ichki IP ga ochilsa — rad).
 * So'rov yuborishda shu tekshiruv `lookup` ichida qilinadi (DNS rebinding oralig'i qolmaydi).
 */
export async function assertSafeUrlResolved(
  rawUrl: string,
  resolve: (host: string) => Promise<Array<{ address: string }>> = (host) =>
    lookup(host, { all: true }),
): Promise<URL> {
  const url = assertSafeUrl(rawUrl);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return url;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await resolve(host);
  } catch {
    throw new Error('Domen topilmadi');
  }
  if (
    addresses.length === 0 ||
    addresses.some((a) => isPrivateAddress(a.address))
  )
    throw new Error("Ichki/xususiy manzilga so'rov taqiqlangan (SSRF)");
  return url;
}
