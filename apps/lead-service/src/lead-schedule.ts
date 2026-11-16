/**
 * Operator navbati qoidalari (BE-13; TZ 5-bo‘lim, 1–8-qoidalar «Qabul qilindi», 2026-10-19).
 * «Raqamlar admin panelda o‘zgartiriladi» — sozlamalar BE-27 da; ungacha shu qiymatlar.
 */
export const QUEUE_RULES = {
  /** 1-qoida: javob bermasa — 15 daq → 1 soat → 3 soat → ertasi kuni 10:00 → keyin kuniga bir marta. */
  retryMinutes: [15, 60, 180],
  nextDayHour: 10,
  /** 2-qoida: «Aloqa bo‘lmadi» — 6 urinish yoki 3 kun, qaysi biri oldin kelsa. */
  maxAttempts: 6,
  /** 3-qoida: qo‘ng‘iroq vaqti 09:00–21:00 (Toshkent); tashqarisi ertasi kuni 09:00 ga. */
  windowStartHour: 9,
  windowEndHour: 21,
  /** 4-qoida: rejalashtirilgan qo‘ng‘iroq operatorda qoladi; vaqtidan 15 daq o‘tsa navbatga. */
  callbackGraceMinutes: 15,
  /** 5-qoida: bron 10 daqiqa. */
  bookingMinutes: 10,
  /** 6-qoida: bir operatorda bir vaqtda ko‘pi bilan 5 ta yangi lid (rejalashtirilganlar kirmaydi). */
  maxNewBookings: 5,
  /** 8-qoida: rejalashtirilgan qo‘ng‘iroqdan 5 daq oldin eslatma. */
  reminderMinutes: 5,
} as const;

const TIME_ZONE = 'Asia/Tashkent';
const MINUTE = 60 * 1000;

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** Toshkent vaqtidagi sana va soat (namuna: finance-service `payout-schedule.util.ts`). */
export function tashkentParts(at: Date): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const n = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)!.value);
  return {
    year: n('year'),
    month: n('month'),
    day: n('day'),
    hour: n('hour'),
    minute: n('minute'),
  };
}

/** Toshkent mahalliy vaqtidan UTC lahzaga (soat farqi Intl dan, kodga yozilmagan). */
export function fromTashkent(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const p = tashkentParts(guess);
  const asLocal = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

function localDayAt(at: Date, dayOffset: number, hour: number): Date {
  const p = tashkentParts(at);
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  return fromTashkent(
    base.getUTCFullYear(),
    base.getUTCMonth() + 1,
    base.getUTCDate(),
    hour,
  );
}

/** 3-qoida: 09:00 dan oldin → shu kuni 09:00; 21:00 va keyin → ertasi kuni 09:00. */
export function clampToCallWindow(at: Date): Date {
  const { hour } = tashkentParts(at);
  if (hour < QUEUE_RULES.windowStartHour)
    return localDayAt(at, 0, QUEUE_RULES.windowStartHour);
  if (hour >= QUEUE_RULES.windowEndHour)
    return localDayAt(at, 1, QUEUE_RULES.windowStartHour);
  return at;
}

/**
 * 1-qoida: `missed` — shu bilan nechanchi «javob bermadi/band/o‘chiq». 1→15 daq, 2→1 soat, 3→3 soat,
 * 4 va keyingilari → ertasi kuni 10:00 («keyin kuniga bir marta» — har safar ertasi 10:00 [taklif: soat qoidada yo‘q]).
 * Natija 3-qoida oynasiga suriladi (BE-13 TC3: 20:50 → ertasi 09:00).
 */
export function retryAt(missed: number, now: Date): Date {
  const ladder = QUEUE_RULES.retryMinutes;
  const raw =
    missed >= 1 && missed <= ladder.length
      ? new Date(now.getTime() + ladder[missed - 1] * MINUTE)
      : localDayAt(now, 1, QUEUE_RULES.nextDayHour);
  return clampToCallWindow(raw);
}

/** TZ 5-bo‘lim natijalar jadvali: «O‘ylab ko‘radi» — vaqt tanlanmasa ertasi kuni (soati 1-qoidadagi 10:00 [taklif]). */
export function nextDayAt(now: Date): Date {
  return clampToCallWindow(localDayAt(now, 1, QUEUE_RULES.nextDayHour));
}

/** 2-qoida: 6 urinish yoki muddat (yaratilgandan 3 kun, `expires_at`) tugagan. */
export function isContactExhausted(
  attempts: number,
  expiresAt: Date | null,
  now: Date,
): boolean {
  return (
    attempts >= QUEUE_RULES.maxAttempts ||
    (!!expiresAt && now.getTime() >= expiresAt.getTime())
  );
}

export const bookingUntil = (now: Date) =>
  new Date(now.getTime() + QUEUE_RULES.bookingMinutes * MINUTE);
export const callbackGraceStart = (now: Date) =>
  new Date(now.getTime() - QUEUE_RULES.callbackGraceMinutes * MINUTE);
export const reminderHorizon = (now: Date) =>
  new Date(now.getTime() + QUEUE_RULES.reminderMinutes * MINUTE);
