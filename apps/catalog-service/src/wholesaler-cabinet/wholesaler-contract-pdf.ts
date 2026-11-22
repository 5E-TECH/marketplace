import PDFDocument from 'pdfkit';
import {
  LegalDocumentDto,
  PDF_FONT,
  registerPdfFonts,
  WholesalerProfileDto,
} from '@app/common';

const LEGAL_TYPE_NAME: Record<string, string> = {
  LEGAL_ENTITY: 'yuridik shaxs',
  SOLE_PROPRIETOR: 'yakka tartibdagi tadbirkor',
};

/**
 * BE-30 (OPT-1): elektron komissiya shartnomasi PDF — optovik rekvizitlari, shartnoma raqami va sanasi, qabul
 * qilingan versiya va vaqti, shu versiya matni (identity da e’lon qilingan). Har so‘rovda yasaladi; ochiq havola yo‘q —
 * faqat imzolangan havola orqali (gateway).
 */
export async function wholesalerContractPdf(
  wholesaler: WholesalerProfileDto,
  contract: LegalDocumentDto,
): Promise<{ fileName: string; contentType: string; base64: string }> {
  const doc = registerPdfFonts(
    new PDFDocument({
      size: 'A4',
      margin: 48,
      compress: false,
      info: { Title: `Komissiya shartnomasi ${wholesaler.contractNumber}` },
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
    .fontSize(14)
    .text(`Komissiya shartnomasi No ${wholesaler.contractNumber ?? '—'}`, {
      align: 'center',
    })
    .moveDown(0.5);
  doc
    .font(PDF_FONT.regular)
    .fontSize(10)
    .text(`Sana: ${wholesaler.contractDate ?? '—'}`)
    .text(
      `Versiya: ${wholesaler.contractVersion ?? contract.version}, elektron qabul qilingan: ${wholesaler.contractAcceptedAt ?? '—'}`,
    )
    .moveDown();
  doc.font(PDF_FONT.bold).text('Komitent (optovik)');
  doc
    .font(PDF_FONT.regular)
    .text(
      `${wholesaler.name}, ${LEGAL_TYPE_NAME[wholesaler.legalType ?? ''] ?? '—'}`,
    )
    .text(`STIR: ${wholesaler.tin ?? '—'}`)
    .text(
      `Bank: ${wholesaler.bankName ?? '—'}, h/r ${wholesaler.bankAccount ?? '—'}, MFO ${wholesaler.bankMfo ?? '—'}`,
    )
    .text(`Telefon: ${wholesaler.phone ?? '—'}`)
    .text(`Manzil: ${wholesaler.address ?? '—'}`)
    .moveDown();
  for (const section of contract.sections) {
    doc.font(PDF_FONT.bold).text(section.title).moveDown(0.2);
    doc.font(PDF_FONT.regular).text(section.body).moveDown(0.6);
  }
  doc.end();
  const pdf = await done;
  return {
    fileName: `shartnoma-${wholesaler.contractNumber ?? wholesaler.id}.pdf`,
    contentType: 'application/pdf',
    base64: pdf.toString('base64'),
  };
}
