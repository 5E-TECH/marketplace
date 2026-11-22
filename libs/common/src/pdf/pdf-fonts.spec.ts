import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import PDFDocument from 'pdfkit';
import {
  PDF_FONT,
  PDF_FONTS_DIR_ENV,
  registerPdfFonts,
  resolvePdfFontsDir,
} from './pdf-fonts';
import { inspectPdf } from './pdf-inspect';

const SAMPLE =
  'Витамин С 1000 мг — Oʻzbekiston, gʻalla, maʼlumot, Ёё Ққ Ғғ Ўў Ҳҳ №5';

const render = (
  draw: (doc: PDFKit.PDFDocument) => void,
  options: PDFKit.PDFDocumentOptions = {},
) => {
  const doc = registerPdfFonts(new PDFDocument(options));
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((ok, fail) => {
    doc.on('end', () => ok(Buffer.concat(chunks)));
    doc.on('error', fail);
  });
  draw(doc);
  doc.end();
  return done;
};

describe('registerPdfFonts (PDF da kirill va ʻ/ʼ)', () => {
  it('oddiy va qalin shrift — DejaVu Sans Condensed, namunaning har harfi uchun glyf bor', () => {
    const doc = registerPdfFonts(new PDFDocument());
    const font = (doc as unknown as { _font: EmbeddedFont })._font;
    expect(font.name).toBe('DejaVuSansCondensed');
    doc.font(PDF_FONT.bold);
    const bold = (doc as unknown as { _font: EmbeddedFont })._font;
    expect(bold.name).toBe('DejaVuSansCondensed-Bold');
    for (const f of [font, bold]) {
      const missing = [...SAMPLE].filter(
        (ch) => !f.font.hasGlyphForCodePoint(ch.codePointAt(0)!),
      );
      expect(missing).toEqual([]);
    }
    doc.end();
  });

  it.each([true, false])(
    'PDF ga shrift joylanadi va matn o‘qiladi (compress: %s), Helvetica yo‘q',
    async (compress) => {
      const pdf = await render(
        (doc) => {
          doc.fontSize(12).text(SAMPLE);
          doc.font(PDF_FONT.bold).text('QABUL QILUVCHI: Каримова Нодира');
          doc.addPage().font(PDF_FONT.regular).text('Ikkinchi sahifa ʼ');
        },
        { compress },
      );

      const { text, fonts } = inspectPdf(pdf);
      expect(text.split('\n')).toEqual([
        SAMPLE,
        'QABUL QILUVCHI: Каримова Нодира',
        'Ikkinchi sahifa ʼ',
      ]);
      expect(fonts).toHaveLength(2);
      expect(fonts).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^[A-Z]{6}\+DejaVuSansCondensed$/),
          expect.stringMatching(/^[A-Z]{6}\+DejaVuSansCondensed-Bold$/),
        ]),
      );
      expect(pdf.toString('latin1')).not.toContain('Helvetica');
    },
  );

  it('glyfi yo‘q harf matnda chiqmaydi (tekshiruv shunchaki yozilganni qaytarmaydi)', async () => {
    const pdf = await render((doc) => doc.text('Ok 中'));
    expect(inspectPdf(pdf).text).not.toContain('中');
  });

  it('inspectPdf standart shriftni sezadi (Helvetica glyf o‘rniga WinAnsi)', async () => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((ok) =>
      doc.on('end', () => ok(Buffer.concat(chunks))),
    );
    doc.text('Витамин');
    doc.end();
    const pdf = await done;

    expect(() => inspectPdf(pdf)).toThrow(/Helvetica/);
  });

  describe('resolvePdfFontsDir', () => {
    const repoFonts = resolve(__dirname, '../../assets/fonts');

    it('manbadan va build’dan (dist ichidan) repo ildizidagi papkani topadi', () => {
      expect(resolvePdfFontsDir(__dirname, {})).toBe(repoFonts);
      const repoRoot = resolve(__dirname, '../../../..');
      const built = join(
        repoRoot,
        'dist/apps/checkout-service/libs/common/src/pdf',
      );
      expect(resolvePdfFontsDir(built, {})).toBe(repoFonts);
    });

    it(`${PDF_FONTS_DIR_ENV} ustun turadi`, () => {
      expect(
        resolvePdfFontsDir(__dirname, { [PDF_FONTS_DIR_ENV]: '/opt/fonts' }),
      ).toBe('/opt/fonts');
    });

    it('topilmasa aniq xato beradi', () => {
      const empty = mkdtempSync(join(tmpdir(), 'pdf-fonts-'));
      expect(() => resolvePdfFontsDir(empty, {})).toThrow(
        /PDF shrifti topilmadi.*PDF_FONTS_DIR/,
      );
    });
  });
});

interface EmbeddedFont {
  name: string;
  font: { hasGlyphForCodePoint(codePoint: number): boolean };
}
