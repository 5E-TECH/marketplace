import { PayoutScheduleFrequency } from '@app/common';

/** Do'kon chastota tanlamagan bo'lsa (Uzum/WB'dagidek haftalik). */
export const DEFAULT_PAYOUT_FREQUENCY = PayoutScheduleFrequency.WEEKLY;

const TIME_ZONE = 'Asia/Tashkent';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bugungi tushum o'tadigan eng yaqin to'lov kuni — doim bugundan KEYIN
 * (bugungi to'lov allaqachon o'tgan bo'lishi mumkin). To'lov kunlari:
 * DAILY — har kuni, WEEKLY — dushanba, MONTHLY — oyning 1-kuni.
 * Natija `YYYY-MM-DD`, Toshkent vaqti bo'yicha.
 */
export function nextPayoutDate(
  frequency: PayoutScheduleFrequency,
  now: Date = new Date(),
): string {
  const today = localDate(now);
  let next: Date;
  switch (frequency) {
    case PayoutScheduleFrequency.DAILY:
      next = new Date(today.getTime() + DAY_MS);
      break;
    case PayoutScheduleFrequency.WEEKLY: {
      const daysUntilMonday = (1 - today.getUTCDay() + 7) % 7 || 7;
      next = new Date(today.getTime() + daysUntilMonday * DAY_MS);
      break;
    }
    case PayoutScheduleFrequency.MONTHLY:
      next = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1),
      );
      break;
  }
  return next.toISOString().slice(0, 10);
}

/** Toshkentdagi bugungi sana — UTC yarim tun sifatida (hisoblash uchun). */
function localDate(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)!.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
}
