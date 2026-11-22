import { createHmac, randomBytes } from 'crypto';

/**
 * BE-26 (T8: «admin va moliya uchun 2FA»): TOTP — RFC 6238 (HMAC-SHA1, 30 soniya, 6 raqam), Google Authenticator va
 * boshqa ilovalar bilan mos. Kutubxonasiz: RFC 4226 (HOTP) ustida.
 */
export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('base32: noto‘g‘ri belgi');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Yangi sir: 20 bayt (160 bit, RFC 4226 tavsiyasi), base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** `step` (30 soniyalik oraliq raqami) uchun 6 raqamli kod. */
export function totpAt(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secretBase32))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Kodni tekshiradi: joriy oraliq va ±`window` (soat farqi). Topilsa — oraliq raqami (qayta ishlatishdan himoya uchun
 * saqlanadi: shu yoki eskiroq oraliq qayta qabul qilinmaydi), topilmasa — null.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  now = Date.now(),
  window = 1,
): number | null {
  if (!/^\d{6}$/.test(String(code ?? ''))) return null;
  const current = totpStep(now);
  for (let d = -window; d <= window; d++)
    if (totpAt(secretBase32, current + d) === code) return current + d;
  return null;
}

/** Authenticator ilovasi uchun havola (QR shu matndan chiziladi). */
export function otpauthUrl(
  secretBase32: string,
  account: string,
  issuer = 'Elchi Marketplace',
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_STEP_SECONDS}`;
}
