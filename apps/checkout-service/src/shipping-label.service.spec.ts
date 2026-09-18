import QRCode from 'qrcode';
import { ShippingLabelService } from './shipping-label.service';

describe('ShippingLabelService (C1.45)', () => {
  const pdfBuffer = (base64: string) => Buffer.from(base64, 'base64');
  const pageCount = (pdf: Buffer) =>
    (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;

  const label = (id: string) => ({
    sellerOrderId: id,
    salesOrderId: '5',
    shipmentId: `125113${id}`,
    qrCodeToken: `token-${id}`,
    buyerName: 'Nodira',
    buyerPhone: '+998901234567',
    deliveryAddress: 'Toshkent, Chilonzor',
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
    qr.mockRestore();
  });
});
