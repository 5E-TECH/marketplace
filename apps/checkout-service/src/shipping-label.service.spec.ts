import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { inspectPdf } from '@app/common/pdf/pdf-inspect';
import {
  LABEL_MAX_ITEMS,
  ShippingLabelService,
} from './shipping-label.service';

describe('ShippingLabelService (C1.45)', () => {
  const pdfBuffer = (base64: string) => Buffer.from(base64, 'base64');
  const pageCount = (pdf: Buffer) =>
    (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;

  const label = (id: string) => ({
    sellerOrderId: id,
    salesOrderId: '5',
    shipmentId: `125113${id}`,
    qrCodeToken: `token-${id}`,
    senderName: 'Nodira Butik',
    buyerName: 'Nodira',
    buyerPhone: '+998901234567',
    regionName: 'Toshkent shahri',
    districtName: 'Chilonzor',
    deliveryAddress: 'Chilonzor 9-kvartal, 12-uy',
    codAmount: 45000,
    items: [{ productName: 'Telefon', quantity: 1 }],
  });

  it('100x60 PDF yaratadi, bitta sahifada qoladi va QR tokenini yozadi', async () => {
    const qr = jest.spyOn(QRCode, 'toBuffer');
    const service = new ShippingLabelService();

    const result = await service.generate({
      sellerOrderId: '9',
      salesOrderId: '5',
      shipmentId: '1251131',
      qrCodeToken: '3e3a70f78d54064348bde43a',
      senderName: 'Nodira Butik',
      buyerName: 'Nodira',
      buyerPhone: '+998901234567',
      deliveryAddress: 'Toshkent, Chilonzor',
      codAmount: 45000,
      items: [{ productName: 'Telefon', quantity: 1 }],
    });

    expect(qr).toHaveBeenCalledWith(
      '3e3a70f78d54064348bde43a',
      expect.objectContaining({ type: 'png', errorCorrectionLevel: 'M' }),
    );
    expect(result).toMatchObject({
      fileName: 'shipment-1251131.pdf',
      contentType: 'application/pdf',
    });
    const pdf = pdfBuffer(result.base64);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
    expect(pdf.toString('latin1')).toMatch(
      /\/MediaBox\s*\[0\s+0\s+283\.465\s+170\.079\]/,
    );
    qr.mockRestore();
  });

  it('TC5: bir nechta yorliqni bitta ko‘p sahifali PDF qiladi', async () => {
    const qr = jest.spyOn(QRCode, 'toBuffer');
    const service = new ShippingLabelService();

    const result = await service.generateBatch([label('9'), label('10')]);

    expect(qr).toHaveBeenCalledTimes(2);
    expect(result.fileName).toBe('shipments-2.pdf');
    const pdf = pdfBuffer(result.base64);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(2);
    expect(result.skipped).toBeUndefined();
    qr.mockRestore();
  });

  it('jo‘natuvchi do‘kon va viloyat/tuman yorliqqa chiziladi', async () => {
    const text = jest.spyOn(PDFDocument.prototype, 'text');

    await new ShippingLabelService().generate(label('9'));

    const written = text.mock.calls.map((call) => call[0]);
    expect(written).toEqual(
      expect.arrayContaining([
        "JO'NATUVCHI",
        'Nodira Butik',
        'Toshkent shahri, Chilonzor',
        'Chilonzor 9-kvartal, 12-uy',
      ]),
    );
    text.mockRestore();
  });

  it(`${LABEL_MAX_ITEMS} tadan ko‘p mahsulot "+ yana N" bo‘ladi, stressda ham 1 sahifa`, async () => {
    const text = jest.spyOn(PDFDocument.prototype, 'text');
    const long = 'Juda uzun nomli mahsulot '.repeat(8);

    const result = await new ShippingLabelService().generate({
      ...label('9'),
      qrCodeToken: 'f'.repeat(64),
      senderName: long,
      buyerName: long,
      regionName: long,
      districtName: long,
      deliveryAddress: long.repeat(3),
      codAmount: 12_000_000,
      items: Array.from({ length: 9 }, (_, i) => ({
        productName: `${long} ${i}`,
        quantity: i + 1,
      })),
    });

    expect(pageCount(pdfBuffer(result.base64))).toBe(1);
    expect(text.mock.calls.map((call) => call[0])).toContain(
      `+ yana ${9 - LABEL_MAX_ITEMS} ta pozitsiya`,
    );
    text.mockRestore();
  });

  it('kirill va ʻ/ʼ yorliqda o‘qiladi, faqat DejaVu shrifti (Helvetica yo‘q)', async () => {
    const result = await new ShippingLabelService().generate({
      ...label('9'),
      senderName: 'Ромашка Савдо',
      buyerName: 'Каримова Нодира',
      districtName: 'Yunusobod',
      deliveryAddress: 'Amir Temur koʻchasi 7-uy, maʼlumot: 3-qavat',
      items: [{ productName: 'Витамин С 1000 мг', quantity: 2 }],
    });

    const pdf = pdfBuffer(result.base64);
    const { text, fonts } = inspectPdf(pdf);
    expect(fonts).toHaveLength(2);
    expect(fonts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^[A-Z]{6}\+DejaVuSansCondensed$/),
        expect.stringMatching(/^[A-Z]{6}\+DejaVuSansCondensed-Bold$/),
      ]),
    );
    expect(text.split('\n')).toEqual(
      expect.arrayContaining([
        'Ромашка Савдо',
        'Каримова Нодира',
        'Toshkent shahri, Yunusobod',
        'Amir Temur koʻchasi 7-uy, maʼlumot: 3-qavat',
        '2 x Витамин С 1000 мг',
      ]),
    );
    expect(pdf.toString('latin1')).not.toContain('Helvetica');
  });

  it('topshirish akti ham DejaVu bilan yoziladi', async () => {
    const result = await new ShippingLabelService().generateHandoverAct({
      id: '5',
      createdAt: '2026-12-16 14:05',
      items: [
        { orderNumber: 'MP-0001', shipmentId: '1251131', qrCodeToken: 'qr-1' },
        { orderNumber: 'MP-0002', shipmentId: '1251132', qrCodeToken: 'qr-2' },
      ],
    });

    const { text, fonts } = inspectPdf(pdfBuffer(result.base64));
    expect(fonts).toHaveLength(2);
    expect(fonts.every((f) => /\+DejaVuSansCondensed(-Bold)?$/.test(f))).toBe(
      true,
    );
    expect(text).toContain('Elchi Pochtaga topshirish akti No 5');
    expect(text).toContain('Posilkalar soni: 2');
    expect(text).toContain('2.   MP-0002   1251132   qr-2');
  });

  it('partiyada chiqmaganlar hujjat bilan birga qaytadi', async () => {
    const skipped = [{ orderId: '7', reason: 'QR tokeni mavjud emas' }];

    const result = await new ShippingLabelService().generateBatch(
      [label('9')],
      skipped,
    );

    expect(result.skipped).toEqual(skipped);
  });
});
