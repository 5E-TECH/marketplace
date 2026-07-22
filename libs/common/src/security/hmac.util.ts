import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Webhook imzosi (Elchi ↔ Marketplace) — HMAC-SHA256.
 * Yuborishda `sign`, qabul qilishda `verify` (timing-safe solishtirish).
 */
export function signHmacSha256(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export function verifyHmacSha256(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = signHmacSha256(payload, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature ?? '', 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
