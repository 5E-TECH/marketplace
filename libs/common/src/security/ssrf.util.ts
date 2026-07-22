/**
 * SSRF himoyasi — tashqi URL'ga so'rov yuborishdan oldin (webhook, provider callback)
 * uning ichki/xususiy tarmoqqa ishora qilmasligini tekshiradi.
 * Faqat http/https, va host xususiy IP/localhost bo'lmasligi kerak.
 */
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1|0\.0\.0\.0)/i;
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[0-1])\./; // 172.16.0.0 – 172.31.255.255

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
  if (PRIVATE_HOST.test(host) || PRIVATE_172.test(host)) {
    throw new Error('Ichki/xususiy manzilga so\'rov taqiqlangan (SSRF)');
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
