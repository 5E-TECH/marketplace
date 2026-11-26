import { ConfigService } from '@nestjs/config';
import { decryptSecret, encryptSecret } from './crypto.util';

const MIN_KEY_LENGTH = 32;

/**
 * BE-32: sotuvchi kartasining provayder tokeni bazada va servislararo faqat shifrlangan (gateway shifrlaydi, finance
 * ochib provayderga yuboradi) — navbatda, DLQ va bazada ochiq token bo‘lmaydi. Kalit yo‘q — null (karta ulanmaydi).
 */
export function payoutKey(config: ConfigService): string | null {
  const key = config.get<string>('PAYOUT_SECRET_KEY')?.trim();
  return key && key.length >= MIN_KEY_LENGTH ? key : null;
}

/** Kartaga avtomatik to‘lov yoqilgan: provayder manzili va token kaliti bor (BE-32). */
export function payoutEnabled(config: ConfigService): boolean {
  return (
    Boolean(config.get<string>('PAYOUT_API_URL')?.trim()) &&
    payoutKey(config) !== null
  );
}

export function sealPayoutToken(token: string, key: string): string {
  return encryptSecret(token, key);
}

/** Kalit boshqa yoki qiymat buzilgan — null (sabab va qiymat logga chiqmaydi). */
export function openPayoutToken(sealed: string, key: string): string | null {
  try {
    return decryptSecret(sealed, key) || null;
  } catch {
    return null;
  }
}
