import { LeadStatus } from '@app/common';

/**
 * Lid qabul qilish qoidalari (BE-12). Har raqamning manbasi yonida. TZ 5-bo‘lim: «Raqamlar admin panelda
 * o‘zgartiriladi» — sozlamalar BE-27 da; ungacha shu qiymatlar.
 * 9 va 10-qoidalar «Taklif — tasdiqlash kerak» (EQ-04): javob kelsa faqat `duplicateDecision` o‘zgaradi.
 */
export const LEAD_RULES = {
  /** 9-qoida: bir raqam va bir mahsulot, 30 kun ichida — yangi lid ochilmaydi. */
  duplicateWindowDays: 30,
  /** 10-qoida: «Rad etildi» — 3 kundan keyingi yangi ariza yangi lid ochadi; 3 kun ichida faqat admin ochadi. */
  rejectedReopenDays: 3,
  /** 2-qoida: «Aloqa bo‘lmadi» — 6 urinish yoki 3 kun. */
  contactWindowDays: 3,
  /** BE-12 kartasi: bir IP dan 10 daqiqada 5 tadan ortiq → tekshiruvga. */
  ipWindowMinutes: 10,
  ipMaxLeads: 5,
  /** 7-bo‘lim «Ketma-ket rad etuvchi mijoz»: bir raqam 2 marta rad etgan → qora ro‘yxat. */
  blacklistRejections: 2,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DuplicateDecision =
  | { kind: 'NEW' }
  /** Yangi ariza avvalgisiga qo‘shiladi (MERGED qator), lid birinchi sotuvchida qoladi. */
  | { kind: 'MERGE'; rootId: string }
  /** Avvalgi lid qayta ochiladi va yangi ariza unga qo‘shiladi (10-qoida). */
  | { kind: 'REOPEN_AND_MERGE'; rootId: string };

/**
 * `previous` — shu raqam va mahsulotdagi 30 kun ichidagi eng so‘nggi asosiy lid (birlashtirilmagan).
 * - yo‘q → yangi lid;
 * - «Rad etildi»: 3 kun ichida — qo‘shiladi (qayta ochishni faqat admin qiladi), keyin — yangi lid yangi sotuvchiga (9, 10-qoidalar);
 * - «Aloqa bo‘lmadi» → avtomatik qayta ochiladi (10-qoida);
 * - «Yaroqsiz» → qayta ochiladi [taklif: qoidalarda yo‘q; ariza yo‘qolmasligi uchun, EQ-04 da so‘raladi];
 * - qolgan holatlar (yangi, bron, qayta qo‘ng‘iroq, tasdiqlangan) → qo‘shiladi (9-qoida).
 */
export function duplicateDecision(
  previous: { id: string; status: LeadStatus; rejectedAt: Date | null } | null,
  now: Date,
): DuplicateDecision {
  if (!previous) return { kind: 'NEW' };
  switch (previous.status) {
    case LeadStatus.REJECTED: {
      const at = previous.rejectedAt?.getTime() ?? 0;
      return now.getTime() - at < LEAD_RULES.rejectedReopenDays * DAY_MS
        ? { kind: 'MERGE', rootId: previous.id }
        : { kind: 'NEW' };
    }
    case LeadStatus.NO_CONTACT:
    case LeadStatus.INVALID:
      return { kind: 'REOPEN_AND_MERGE', rootId: previous.id };
    default:
      return { kind: 'MERGE', rootId: previous.id };
  }
}

export const duplicateWindowStart = (now: Date) =>
  new Date(now.getTime() - LEAD_RULES.duplicateWindowDays * DAY_MS);

export const contactDeadline = (now: Date) =>
  new Date(now.getTime() + LEAD_RULES.contactWindowDays * DAY_MS);

export const ipWindowStart = (now: Date) =>
  new Date(now.getTime() - LEAD_RULES.ipWindowMinutes * 60 * 1000);

/** Yashirin maydon to‘ldirilganmi: bo‘sh satr yoki yo‘q — odam; boshqa har qanday qiymat — bot (BE-12 TC4). */
export const isHoneypotFilled = (value: unknown) =>
  value !== undefined && value !== null && value !== '';

/**
 * Operator kodi (LID-2: «O‘zbekiston operator kodi bilan bo‘lmasa qabul qilinmaydi»). Ro‘yxat sozlamadan
 * (`LEAD_PHONE_OPERATOR_CODES`, vergul bilan) — kodlar ega tasdiqlaydi; berilmasa faqat +998 va 9 raqam tekshiriladi.
 */
export function phoneOperatorAllowed(
  phoneE164: string,
  allowedCodes: string[],
): boolean {
  if (allowedCodes.length === 0) return true;
  return allowedCodes.includes(phoneE164.slice(4, 6));
}
