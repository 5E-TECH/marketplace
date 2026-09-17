import QRCode from 'qrcode';
import { ShippingLabelService } from './shipping-label.service';

describe('ShippingLabelService (C1.45)', () => {
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

  it('100x150 PDF yaratadi va QR ichiga Elchi tokenini yozadi', async () => {
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
    expect(Buffer.from(result.base64, 'base64').subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
    qr.mockRestore();
  });

  it('TC5: bir nechta yorliqni bitta ko‘p sahifali PDF qiladi', async () => {
    const qr = jest.spyOn(QRCode, 'toBuffer');
    const service = new ShippingLabelService();

    const result = await service.generateBatch([label('9'), label('10')]);

    expect(qr).toHaveBeenCalledTimes(2);
    expect(result.fileName).toBe('shipments-2.pdf');
    expect(Buffer.from(result.base64, 'base64').subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
    qr.mockRestore();
  });
});
