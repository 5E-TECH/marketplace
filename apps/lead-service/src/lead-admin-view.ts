import {
  AdminLeadSort,
  AdminLeadTab,
  LeadRejectReason,
  LeadStatus,
} from '@app/common';
import { Lead } from './entities';
import { tashkentParts } from './lead-schedule';

/** Faol lid: navbatda, bronda yoki qayta qo‘ng‘iroqda. */
export const ACTIVE_STATUSES = [
  LeadStatus.NEW,
  LeadStatus.BOOKED,
  LeadStatus.CALLBACK,
];

/** Yorliq sharti (BE-25, FE-26). «Ishda» va «Tekshiruvda» kesishmaydi: tekshiruvdagi ariza navbatga tushmagan. */
export const IN_REVIEW = `(l.review_reason IS NOT NULL AND l.merged_into_id IS NULL AND l.status IN ('NEW','BOOKED','CALLBACK'))`;
export const TAB_SQL: Record<
  Exclude<AdminLeadTab, AdminLeadTab.ALL>,
  string
> = {
  [AdminLeadTab.ACTIVE]: `(l.status IN ('NEW','BOOKED','CALLBACK') AND NOT ${IN_REVIEW})`,
  [AdminLeadTab.CONFIRMED]: `l.status = 'CONFIRMED'`,
  [AdminLeadTab.REJECTED]: `l.status = 'REJECTED'`,
  [AdminLeadTab.CLOSED]: `l.status IN ('INVALID','MERGED','NO_CONTACT')`,
  [AdminLeadTab.REVIEW]: IN_REVIEW,
};

export const inReview = (
  lead: Pick<Lead, 'reviewReason' | 'mergedIntoId' | 'status'>,
): boolean =>
  lead.reviewReason !== null &&
  lead.mergedIntoId === null &&
  ACTIVE_STATUSES.includes(lead.status);

export const SORT_SQL: Record<
  AdminLeadSort,
  { by: string; direction: 'ASC' | 'DESC' }
> = {
  [AdminLeadSort.CREATED_ASC]: { by: 'l.created_at', direction: 'ASC' },
  [AdminLeadSort.CREATED_DESC]: { by: 'l.created_at', direction: 'DESC' },
  [AdminLeadSort.PRICE_ASC]: { by: 'l.sale_price', direction: 'ASC' },
  [AdminLeadSort.PRICE_DESC]: { by: 'l.sale_price', direction: 'DESC' },
  [AdminLeadSort.ATTEMPTS_ASC]: { by: 'l.attempts', direction: 'ASC' },
  [AdminLeadSort.ATTEMPTS_DESC]: { by: 'l.attempts', direction: 'DESC' },
};

/** «L-1284», «l1284» yoki «1284» — lid raqami; boshqasi — null. */
export function leadNumber(text: string): string | null {
  const match = /^(?:l-?)?([1-9]\d{0,17})$/i.exec(text.trim());
  return match ? match[1] : null;
}

/** ILIKE da foydalanuvchi matni so‘zma-so‘z: `%`, `_` va `\` maxsus ma’noda emas. */
export const likeText = (text: string) =>
  `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const REJECT_LABELS: Record<LeadRejectReason, string> = {
  [LeadRejectReason.TOO_EXPENSIVE]: 'Qimmat',
  [LeadRejectReason.NOT_NEEDED]: 'Kerak emas',
  [LeadRejectReason.BOUGHT_ELSEWHERE]: 'Boshqa joydan oldi',
  [LeadRejectReason.OTHER]: 'Boshqa sabab',
};

export const STATUS_LABELS: Record<LeadStatus, string> = {
  [LeadStatus.NEW]: 'Yangi',
  [LeadStatus.BOOKED]: 'Bronda',
  [LeadStatus.CALLBACK]: 'Qayta qo‘ng‘iroq',
  [LeadStatus.CONFIRMED]: 'Tasdiqlandi',
  [LeadStatus.REJECTED]: 'Rad etildi',
  [LeadStatus.INVALID]: 'Yaroqsiz',
  [LeadStatus.MERGED]: 'Dublikat',
  [LeadStatus.NO_CONTACT]: 'Aloqa bo‘lmadi',
};

const two = (n: number) => String(n).padStart(2, '0');

/** «13.01, 10:01» — Toshkent vaqti. */
export function shortTime(at: Date): string {
  const p = tashkentParts(at);
  return `${two(p.day)}.${two(p.month)}, ${two(p.hour)}:${two(p.minute)}`;
}

/** «14.01.2027 14:32» — Toshkent vaqti (CSV). */
export function fullTime(at: Date): string {
  const p = tashkentParts(at);
  return `${two(p.day)}.${two(p.month)}.${p.year} ${two(p.hour)}:${two(p.minute)}`;
}

/** Yopilgan lid ostidagi sabab (dizayn admin-lidlar). */
export function closedNote(
  lead: Pick<Lead, 'status' | 'rejectReason' | 'mergedIntoId' | 'attempts'>,
  statusAt: Date,
): string | null {
  switch (lead.status) {
    case LeadStatus.REJECTED:
      return lead.rejectReason ? REJECT_LABELS[lead.rejectReason] : null;
    case LeadStatus.MERGED:
      return lead.mergedIntoId ? `→ L-${lead.mergedIntoId} · asosiy lid` : null;
    case LeadStatus.NO_CONTACT:
      return `${lead.attempts} urinish · ${shortTime(statusAt)}`;
    default:
      return null;
  }
}

/** Mijoz aytgan vaqt: egasi bor qayta qo‘ng‘iroq yoki shundan olingan bron. */
export const callbackAtOf = (
  lead: Pick<
    Lead,
    'status' | 'operatorId' | 'bookedFromCallback' | 'nextAttemptAt'
  >,
): Date | null =>
  (lead.status === LeadStatus.CALLBACK && lead.operatorId !== null) ||
  (lead.status === LeadStatus.BOOKED && lead.bookedFromCallback)
    ? lead.nextAttemptAt
    : null;

/**
 * 2-qoida bo‘yicha o‘zi yopiladigan vaqt. `LeadQueueService.sweep` bilan bir xil: egasiz (avtomatik) qayta urinish; bronda
 * — natija «aloqa bo‘lmadi» bo‘lsa shu vaqt hal qiladi. Mijoz aytgan qo‘ng‘iroq va hali qo‘ng‘iroq qilinmagan lid — yo‘q.
 */
export function closesAtOf(
  lead: Pick<
    Lead,
    'status' | 'operatorId' | 'bookedFromCallback' | 'attempts' | 'expiresAt'
  >,
): Date | null {
  if (lead.status === LeadStatus.CALLBACK)
    return lead.operatorId === null && lead.attempts > 0
      ? lead.expiresAt
      : null;
  if (lead.status === LeadStatus.BOOKED)
    return lead.bookedFromCallback ? null : lead.expiresAt;
  return null;
}

/** User agent dan «Android · Chrome». Aniqlanmasa — null (taxmin qilinmaydi). */
export function deviceOf(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const os = /iPhone|iPod/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Macintosh|Mac OS X/.test(userAgent)
            ? 'macOS'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : null;
  const browser = /Instagram/.test(userAgent)
    ? 'Instagram'
    : /FBAN|FBAV|FB_IAB/.test(userAgent)
      ? 'Facebook'
      : /musical_ly|TikTok|BytedanceWebview/.test(userAgent)
        ? 'TikTok'
        : /Telegram/.test(userAgent)
          ? 'Telegram'
          : /YaBrowser/.test(userAgent)
            ? 'Yandex'
            : /SamsungBrowser/.test(userAgent)
              ? 'Samsung Internet'
              : /Edg(?:A|iOS)?\//.test(userAgent)
                ? 'Edge'
                : /OPR\/|Opera/.test(userAgent)
                  ? 'Opera'
                  : /Firefox|FxiOS/.test(userAgent)
                    ? 'Firefox'
                    : /CriOS|Chrome\//.test(userAgent)
                      ? 'Chrome'
                      : /Safari\//.test(userAgent)
                        ? 'Safari'
                        : null;
  return [os, browser].filter(Boolean).join(' · ') || null;
}

/** «sub2=kampaniya · sub3=kreativ-4» — to‘ldirilganlari; hammasi bo‘sh — null. */
export function subsText(
  lead: Pick<Lead, 'sub2' | 'sub3' | 'sub4' | 'sub5'>,
): string | null {
  const parts = (['sub2', 'sub3', 'sub4', 'sub5'] as const)
    .filter((key) => !!lead[key])
    .map((key) => `${key}=${lead[key]}`);
  return parts.length ? parts.join(' · ') : null;
}
