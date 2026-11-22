import { leadQueueStats } from './lead-ops.controller';

describe('BE-26: lid navbati ko‘rsatkichi (qo‘ng‘iroq oynasi 09:00–21:00 Toshkent)', () => {
  const t = (iso: string) => new Date(iso);

  it('oyna ichida — eng eski lid kutish daqiqasi', () => {
    expect(
      leadQueueStats(
        3,
        t('2026-12-01T10:00:00+05:00'),
        t('2026-12-01T10:14:30+05:00'),
      ),
    ).toEqual({ waiting: 3, oldestMinutes: 14 });
  });

  it('kechasi kelgan lid — ertalab 09:00 dan hisoblanadi', () => {
    expect(
      leadQueueStats(
        1,
        t('2026-11-30T22:30:00+05:00'),
        t('2026-12-01T09:05:00+05:00'),
      ),
    ).toEqual({ waiting: 1, oldestMinutes: 5 });
  });

  it('oyna tashqarisida va navbat bo‘sh — null (ogohlantirish yo‘q)', () => {
    expect(
      leadQueueStats(
        2,
        t('2026-12-01T20:00:00+05:00'),
        t('2026-12-01T23:00:00+05:00'),
      ),
    ).toEqual({ waiting: 2, oldestMinutes: null });
    expect(leadQueueStats(0, null, t('2026-12-01T12:00:00+05:00'))).toEqual({
      waiting: 0,
      oldestMinutes: null,
    });
  });
});
