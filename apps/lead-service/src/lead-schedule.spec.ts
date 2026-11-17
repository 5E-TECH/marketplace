import {
  clampToCallWindow,
  fromTashkent,
  isContactExhausted,
  QUEUE_RULES,
  retryAt,
  tashkentParts,
} from './lead-schedule';

const at = (h: number, m = 0) => fromTashkent(2026, 12, 10, h, m);
const local = (d: Date) => {
  const p = tashkentParts(d);
  return `${p.day}.${p.month} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

describe('Navbat jadvali (BE-13; TZ 5-bo‘lim 1–3-qoidalar)', () => {
  it('qiymatlar TZ bilan bir xil', () => {
    expect(QUEUE_RULES).toMatchObject({
      retryMinutes: [15, 60, 180],
      nextDayHour: 10,
      maxAttempts: 6,
      windowStartHour: 9,
      windowEndHour: 21,
      callbackGraceMinutes: 15,
      bookingMinutes: 10,
      maxNewBookings: 5,
      reminderMinutes: 5,
    });
  });

  it('Toshkent vaqti: 10.12 12:30 qaytib o‘qiladi', () => {
    expect(local(at(12, 30))).toBe('10.12 12:30');
  });

  it('1-qoida: 15 daq → 1 soat → 3 soat → ertasi 10:00 → yana ertasi 10:00', () => {
    const now = at(11);
    expect(local(retryAt(1, now))).toBe('10.12 11:15');
    expect(local(retryAt(2, now))).toBe('10.12 12:00');
    expect(local(retryAt(3, now))).toBe('10.12 14:00');
    expect(local(retryAt(4, now))).toBe('11.12 10:00');
    expect(local(retryAt(5, now))).toBe('11.12 10:00');
  });

  it('TC3: 20:50 da «javob bermadi» → ertasi 09:00 (3-qoida)', () => {
    expect(local(retryAt(1, at(20, 50)))).toBe('11.12 09:00');
  });

  it('3-qoida: 09:00 dan oldin → shu kuni 09:00; 21:00 → ertasi 09:00; oynada o‘zgarmaydi', () => {
    expect(local(clampToCallWindow(at(7, 30)))).toBe('10.12 09:00');
    expect(local(clampToCallWindow(at(21)))).toBe('11.12 09:00');
    expect(local(clampToCallWindow(at(15, 5)))).toBe('10.12 15:05');
  });

  it('2-qoida: 6 urinish yoki muddat tugadi', () => {
    const now = at(12);
    expect(isContactExhausted(6, null, now)).toBe(true);
    expect(isContactExhausted(2, at(11), now)).toBe(true);
    expect(isContactExhausted(5, at(13), now)).toBe(false);
  });
});
