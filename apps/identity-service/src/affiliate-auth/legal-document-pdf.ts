import PDFDocument from 'pdfkit';
import {
  LegalDocumentDto,
  LegalDocumentType,
  PDF_FONT,
  registerPdfFonts,
} from '@app/common';

const TITLE: Record<LegalDocumentType, string> = {
  [LegalDocumentType.AFFILIATE_OFFER]: 'Sotuvchi ofertasi',
  [LegalDocumentType.PERSONAL_DATA_CONSENT]:
    'Shaxsiy ma’lumotlarni qayta ishlashga rozilik',
  [LegalDocumentType.WHOLESALER_CONTRACT]: 'Komissiya shartnomasi (optovik)',
};
const FILE: Record<LegalDocumentType, string> = {
  [LegalDocumentType.AFFILIATE_OFFER]: 'sotuvchi-ofertasi',
  [LegalDocumentType.PERSONAL_DATA_CONSENT]: 'rozilik',
  [LegalDocumentType.WHOLESALER_CONTRACT]: 'komissiya-shartnomasi',
};

/** Kuchga kirgan sana — Toshkent kuni, `dd.mm.yyyy`. */
function tashkentDay(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * BE-25 6-tur (FE-04 «PDF yuklab olish»): hujjatning e’lon qilingan matni PDF da — sotuvchi o‘qigan va qabul qilgan matn
 * bilan aynan bir xil [taklif: superadmin alohida fayl yuklamaydi]. Boshqa hech narsa qo‘shilmaydi.
 */
export async function legalDocumentPdf(
  document: LegalDocumentDto,
): Promise<{ fileName: string; contentType: string; base64: string }> {
  const title = TITLE[document.type];
  const doc = registerPdfFonts(
    new PDFDocument({
      size: 'A4',
      margin: 48,
      info: { Title: `${title}, ${document.version}-versiya` },
    }),
  );
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc
    .font(PDF_FONT.bold)
    .fontSize(16)
    .text(title, { align: 'center' })
    .moveDown(0.5);
  doc
    .font(PDF_FONT.regular)
    .fontSize(10)
    .text(
      `${document.version}-versiya${document.effectiveAt ? `, kuchga kirgan: ${tashkentDay(document.effectiveAt)}` : ''}`,
      { align: 'center' },
    )
    .moveDown();
  if (document.summary.length) {
    doc.font(PDF_FONT.bold).fontSize(11).text('Asosiy shartlar').moveDown(0.3);
    for (const item of document.summary)
      doc
        .font(PDF_FONT.bold)
        .fontSize(10)
        .text(`${item.term} — `, { continued: true })
        .font(PDF_FONT.regular)
        .text(item.text)
        .moveDown(0.2);
    doc.moveDown(0.6);
  }
  for (const section of document.sections) {
    doc.font(PDF_FONT.bold).fontSize(11).text(section.title).moveDown(0.2);
    doc.font(PDF_FONT.regular).fontSize(10).text(section.body).moveDown(0.6);
  }
  doc.end();
  return {
    fileName: `${FILE[document.type]}-${document.version}.pdf`,
    contentType: 'application/pdf',
    base64: (await done).toString('base64'),
  };
}
