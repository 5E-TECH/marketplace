/**
 * pdfkit standart shrifti (Helvetica) faqat WinAnsi: o‘zbekcha «ʻ» (U+02BB) va «ʼ» (U+02BC) «»» bo‘lib chiqadi —
 * WinAnsi dagi ‘ va ’ ga almashtiriladi. Kirill harflari uchun Unicode shrift kerak (hamma PDF lar uchun alohida ish).
 */
export function pdfText(value: string): string {
  return value.replace(/[ʻʽ]/g, '‘').replace(/ʼ/g, '’');
}

/** Hujjatdagi hamma matn `pdfText` dan o‘tadi. */
export function uzbekText(doc: PDFKit.PDFDocument): PDFKit.PDFDocument {
  const original = doc.text.bind(doc) as (
    ...args: unknown[]
  ) => PDFKit.PDFDocument;
  doc.text = ((value: unknown, ...rest: unknown[]) =>
    original(
      typeof value === 'string' ? pdfText(value) : value,
      ...rest,
    )) as typeof doc.text;
  return doc;
}

/** Sana va vaqt Toshkentda: `YYYY-MM-DD HH:MM`. */
export function tashkentTime(value: Date | string): string {
  return new Date(value)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' })
    .slice(0, 16);
}
