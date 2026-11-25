import { LegalDocumentDto, LegalDocumentType } from '@app/common';
import { inspectPdf } from '@app/common/pdf/pdf-inspect';
import { legalDocumentPdf } from './legal-document-pdf';

const doc = (over: Partial<LegalDocumentDto> = {}): LegalDocumentDto => ({
  type: LegalDocumentType.AFFILIATE_OFFER,
  version: '1.1',
  // Toshkentda 15-yanvar 00:30
  effectiveAt: '2027-01-14T19:30:00.000Z',
  summary: [
    { term: 'Haq', text: 'faqat mijoz to‘lagan buyurtma uchun, so‘mda.' },
  ],
  sections: [
    { id: 's1', title: '1. Atamalar va taraflar', body: 'Сотувчи — oʻzbek.' },
    { id: 's2', title: '2. Pul yechish', body: 'Birinchi qator.\nIkkinchi.' },
  ],
  ...over,
});
const textOf = async (document: LegalDocumentDto) =>
  inspectPdf(
    Buffer.from((await legalDocumentPdf(document)).base64, 'base64'),
  ).text.replace(/\s+/g, ' ');

describe('BE-25 6-tur: hujjat PDF i', () => {
  it('e’lon qilingan matnning o‘zi: versiya, sana (Toshkent), asosiy shartlar, hamma bo‘limlar; kirill va ʻ', async () => {
    const pdf = await legalDocumentPdf(doc());
    expect(pdf).toMatchObject({
      fileName: 'sotuvchi-ofertasi-1.1.pdf',
      contentType: 'application/pdf',
    });
    const text = await textOf(doc());
    for (const part of [
      'Sotuvchi ofertasi',
      '1.1-versiya, kuchga kirgan: 15.01.2027',
      'Asosiy shartlar',
      'Haq —',
      'faqat mijoz to‘lagan buyurtma uchun, so‘mda.',
      '1. Atamalar va taraflar',
      'Сотувчи — oʻzbek.',
      '2. Pul yechish',
      'Birinchi qator.',
      'Ikkinchi.',
    ])
      expect(text).toContain(part);
  });

  it('har tur o‘z nomi bilan; asosiy shartlarsiz sarlavhasi ham yo‘q', async () => {
    const consent = doc({
      type: LegalDocumentType.PERSONAL_DATA_CONSENT,
      summary: [],
    });
    expect((await legalDocumentPdf(consent)).fileName).toBe('rozilik-1.1.pdf');
    const text = await textOf(consent);
    expect(text).toContain('Shaxsiy ma’lumotlarni qayta ishlashga rozilik');
    expect(text).not.toContain('Asosiy shartlar');
    expect(
      (
        await legalDocumentPdf(
          doc({ type: LegalDocumentType.WHOLESALER_CONTRACT }),
        )
      ).fileName,
    ).toBe('komissiya-shartnomasi-1.1.pdf');
  });

  it('uzun hujjat — bir necha sahifa, oxirgi bo‘lim ham bor', async () => {
    const text = await textOf(
      doc({
        sections: Array.from({ length: 60 }, (_, i) => ({
          id: `s${i}`,
          title: `${i + 1}. Bo‘lim`,
          body: 'Matn '.repeat(120),
        })),
      }),
    );
    expect(text).toContain('60. Bo‘lim');
  });
});
