import { shortPersonName, staffRoleLabel, UserNamesClient } from '@app/common';

/**
 * Akt PDF lari uchun matn yordamchilari. Shrift — `registerPdfFonts` (`@app/common`): kirill va o‘zbekcha ʻ/ʼ
 * o‘z holicha chiqadi, ‘/’ ga almashtirish shart emas.
 */

/** Sana va vaqt Toshkentda: `YYYY-MM-DD HH:MM`. */
export function tashkentTime(value: Date | string): string {
  return new Date(value)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' })
    .slice(0, 16);
}

/** Farq ishorasi bilan: «+3», «−2» (U+2212), «0» — frontenddagi akt ekrani (InboundActPage `signed`) bilan bir xil. */
export function signedQty(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return '0';
}

/** Kun (`YYYY-MM-DD`) dan `days` kun oldingi kun. */
export function minusDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Hujjatdagi xodim: «Jasur T., omborchi» (dizayn `hujjat-*`). Ism topilmasa yoki identity javob bermasa — `#ID`;
 * ism hech qachon PDF ni yiqitmaydi.
 */
export async function staffName(
  names: UserNamesClient | undefined,
  id: string | null | undefined,
): Promise<{ label: string; short: string }> {
  if (!id) return { label: '—', short: '—' };
  const row = (await names?.lookup([id]))?.get(String(id));
  const short = row?.name ? shortPersonName(row.name) : `#${id}`;
  const role = row ? staffRoleLabel(row.role) : '';
  return { label: role ? `${short}, ${role}` : short, short };
}
