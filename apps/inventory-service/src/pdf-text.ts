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

/** Sana va vaqt Toshkentda hujjat ko‘rinishida: `DD.MM.YYYY, HH:MM` (dizayn h-1 §3.1, «14.01.2027, 14:39»). */
export function tashkentDateTime(value: Date | string): string {
  const [day, time] = tashkentTime(value).split(' ');
  return `${dmy(day)}, ${time}`;
}

/** Kun `YYYY-MM-DD` → `DD.MM.YYYY`; bo‘sh — null. */
export function dmy(day: string | null | undefined): string | null {
  return day ? day.slice(0, 10).split('-').reverse().join('.') : null;
}

/** Keyingi blok (xulosa va imzolar) bo‘linib ketmasin: joy yetmasa — yangi bet. */
export function keepTogether(doc: PDFKit.PDFDocument, height: number): void {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

/**
 * Har betga pastki yozuv «… · k / n bet» (hujjat yopilishidan oldin; `bufferPages: true` bilan yaratilgan bo‘lsin).
 * Pastki hoshiyaga yoziladi — yangi bet qo‘shilmaydi.
 */
export function pageFooters(
  doc: PDFKit.PDFDocument,
  lines: (page: number, count: number) => string[],
): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    let y = doc.page.height - bottom + 6;
    doc.fontSize(8);
    for (const line of lines(i - range.start + 1, range.count)) {
      doc.text(line, left, y, { width, lineBreak: false });
      y += 10;
    }
    doc.page.margins.bottom = bottom;
  }
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
