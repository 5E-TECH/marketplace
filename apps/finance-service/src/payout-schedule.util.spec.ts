import { PayoutScheduleFrequency } from '@app/common';
import { nextPayoutDate } from './payout-schedule.util';

const { DAILY, WEEKLY, MONTHLY } = PayoutScheduleFrequency;

describe('nextPayoutDate', () => {
  // 2026-10-02 — juma.
  const friday = new Date('2026-10-02T10:00:00+05:00');

  it('DAILY — ertangi kun', () => {
    expect(nextPayoutDate(DAILY, friday)).toBe('2026-10-03');
  });

  it('WEEKLY — keyingi dushanba', () => {
    expect(nextPayoutDate(WEEKLY, friday)).toBe('2026-10-05');
  });

  it('WEEKLY — dushanba kuni bugun emas, keyingi haftaga o‘tadi', () => {
    const monday = new Date('2026-10-05T09:00:00+05:00');
    expect(nextPayoutDate(WEEKLY, monday)).toBe('2026-10-12');
  });

  it('MONTHLY — keyingi oyning 1-kuni, yil almashinuvi bilan', () => {
    expect(nextPayoutDate(MONTHLY, friday)).toBe('2026-11-01');
    const lastDay = new Date('2026-12-31T12:00:00+05:00');
    expect(nextPayoutDate(MONTHLY, lastDay)).toBe('2027-01-01');
    // 1-sana bo'lsa ham keyingi oy.
    const firstDay = new Date('2026-10-01T12:00:00+05:00');
    expect(nextPayoutDate(MONTHLY, firstDay)).toBe('2026-11-01');
  });

  it('kun Toshkent vaqti bo‘yicha: UTC’da hali kecha bo‘lsa ham', () => {
    // 2026-10-04 21:30 UTC = 2026-10-05 02:30 Toshkent (dushanba).
    const lateUtc = new Date('2026-10-04T21:30:00Z');
    expect(nextPayoutDate(DAILY, lateUtc)).toBe('2026-10-06');
    expect(nextPayoutDate(WEEKLY, lateUtc)).toBe('2026-10-12');
  });
});
