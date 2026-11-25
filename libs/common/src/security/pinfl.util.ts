import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { decryptSecret, encryptSecret } from './crypto.util';

/** JShShIR — 14 raqam (davlat standarti; TZ da yozilmagan [taklif]). */
export const PINFL = /^\d{14}$/;
const MIN_KEY_LENGTH = 32;

/**
 * BE-25 5-tur: JShShIR servislararo ham, bazada ham faqat shifrlangan (gateway shifrlaydi, finance ochib tekshiradi) —
 * RabbitMQ navbatida va DLQ da ochiq raqam bo‘lmaydi. Kalit yo‘q — ariza qabul qilinmaydi.
 */
export function pinflKey(config: ConfigService): string {
  const key = config.get<string>('SELF_EMPLOYED_SECRET_KEY')?.trim();
  if (!key || key.length < MIN_KEY_LENGTH)
    throw new ServiceUnavailableException(
      'SELF_EMPLOYED_SECRET_KEY sozlanmagan — JShShIR qabul qilinmaydi',
    );
  return key;
}

export function sealPinfl(pinfl: string, key: string): string {
  return encryptSecret(pinfl, key);
}

/** Kalit boshqa yoki qiymat buzilgan bo‘lsa — null (sabab va qiymat logga chiqmaydi). */
export function openPinfl(sealed: string, key: string): string | null {
  try {
    const pinfl = decryptSecret(sealed, key);
    return PINFL.test(pinfl) ? pinfl : null;
  } catch {
    return null;
  }
}

/** Kalitli xesh — bir JShShIR ikki sotuvchida ekanini ko‘rish uchun (ochib bo‘lmaydi). */
export function pinflHash(pinfl: string, key: string): string {
  return createHmac('sha256', `elchi:pinfl-hash:v1:${key}`)
    .update(pinfl)
    .digest('hex');
}
