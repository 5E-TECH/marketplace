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
