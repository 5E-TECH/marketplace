import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * PDF hujjatlar uchun Unicode shrift nomlari (`doc.font(PDF_FONT.bold)`).
 * pdfkit’ning standart Helvetica shrifti faqat WinAnsi: kirill harflari va o‘zbekcha ʻ/ʼ buziladi.
 * Shrift — DejaVu Sans Condensed (kengligi Helvetica bilan bir xil), `libs/common/assets/fonts`.
 */
export const PDF_FONT = {
  regular: 'elchi-regular',
  bold: 'elchi-bold',
} as const;

const FONT_FILES: Record<string, string> = {
  [PDF_FONT.regular]: 'DejaVuSansCondensed.ttf',
  [PDF_FONT.bold]: 'DejaVuSansCondensed-Bold.ttf',
};

/** Shriftlar boshqa joyda bo‘lsa — papka yo‘li. */
export const PDF_FONTS_DIR_ENV = 'PDF_FONTS_DIR';

const ASSET_DIR = join('libs', 'common', 'assets', 'fonts');

/**
 * Shrift papkasi: `PDF_FONTS_DIR`, bo‘lmasa `start` dan yuqoriga qarab birinchi `libs/common/assets/fonts`.
 * Manbadan (jest, `nest start`) — repo ildizi; build’dan (`dist/apps/<servis>/libs/common/src/pdf`) ham repo ildizi;
 * Docker’da — `/app/libs/common/assets/fonts` (Dockerfile ko‘chiradi).
 */
export function resolvePdfFontsDir(
  start: string = __dirname,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env[PDF_FONTS_DIR_ENV]?.trim();
  if (fromEnv) return fromEnv;
  for (let dir = start; ; dir = dirname(dir)) {
    const candidate = join(dir, ASSET_DIR);
    if (existsSync(join(candidate, FONT_FILES[PDF_FONT.regular]))) {
      return candidate;
    }
    if (dirname(dir) === dir) {
      throw new Error(
        `PDF shrifti topilmadi: ${ASSET_DIR} (${start} dan yuqorida). Papkani ${PDF_FONTS_DIR_ENV} bilan bering.`,
      );
    }
  }
}

let cache: Array<[string, Buffer]> | undefined;

/** Shrift fayllari bir marta o‘qiladi; har hujjat o‘zi faqat ishlatilgan glyflarni joylaydi (subset). */
function fontFiles(): Array<[string, Buffer]> {
  if (!cache) {
    const dir = resolvePdfFontsDir();
    cache = Object.entries(FONT_FILES).map(([name, file]) => [
      name,
      readFileSync(join(dir, file)),
    ]);
  }
  return cache;
}

/**
 * Hujjatga `PDF_FONT.regular` va `PDF_FONT.bold` ni qo‘shadi va oddiy shriftni tanlaydi.
 * `new PDFDocument(...)` dan keyin darhol chaqiriladi; keyin `doc.font('Helvetica…')` ishlatilmaydi.
 */
export function registerPdfFonts<T extends PDFKit.PDFDocument>(doc: T): T {
  for (const [name, data] of fontFiles()) doc.registerFont(name, data);
  doc.font(PDF_FONT.regular);
  return doc;
}
