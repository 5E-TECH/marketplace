import { of } from 'rxjs';
import { SellerOrdersController } from './seller-orders.controller';
import { SellerOrdersService } from './seller-orders.service';
import { ShippingLabelService } from './shipping-label.service';

describe('SellerOrdersController label RPC (C1.45)', () => {
  it('owner shopini resolve qilib PDF generatorga uzatadi', async () => {
    const data = {
      sellerOrderId: '9',
      salesOrderId: '5',
      shipmentId: '1251131',
      qrCodeToken: 'token',
      buyerName: 'Nodira',
      buyerPhone: '+998901234567',
      deliveryAddress: 'Toshkent',
      codAmount: 45000,
      items: [],
    };
    const getShippingLabelData = jest.fn().mockResolvedValue(data);
    const generate = jest.fn().mockResolvedValue({
      fileName: 'shipment-1251131.pdf',
      contentType: 'application/pdf',
      base64: 'JVBERg==',
    });
    const controller = new SellerOrdersController(
      { getShippingLabelData } as unknown as SellerOrdersService,
      { send: jest.fn(() => of({ id: '4' })) } as never,
      { send: jest.fn() } as never,
      { generate } as unknown as ShippingLabelService,
    );

    await expect(
      controller.label({ ownerUserId: '42', orderId: '9' }),
    ).resolves.toMatchObject({ contentType: 'application/pdf' });
    expect(getShippingLabelData).toHaveBeenCalledWith('4', '9');
    expect(generate).toHaveBeenCalledWith(data);
  });

  it('TC5: bir nechta orderni bitta batch PDF generatoriga uzatadi', async () => {
    const getShippingLabelData = jest
      .fn()
      .mockImplementation((_shopId, id) =>
        Promise.resolve({ sellerOrderId: id, qrCodeToken: `token-${id}` }),
      );
    const generateBatch = jest.fn().mockResolvedValue({
      fileName: 'shipments-2.pdf',
      contentType: 'application/pdf',
      base64: 'JVBERg==',
    });
    const controller = new SellerOrdersController(
      { getShippingLabelData } as unknown as SellerOrdersService,
      { send: jest.fn(() => of({ id: '4' })) } as never,
      { send: jest.fn() } as never,
      { generateBatch } as unknown as ShippingLabelService,
    );

    await controller.labelsBatch({
      ownerUserId: '42',
      orderIds: ['9', '10'],
    });

    expect(getShippingLabelData).toHaveBeenNthCalledWith(1, '4', '9');
    expect(getShippingLabelData).toHaveBeenNthCalledWith(2, '4', '10');
    expect(generateBatch).toHaveBeenCalledWith([
      expect.objectContaining({ sellerOrderId: '9' }),
      expect.objectContaining({ sellerOrderId: '10' }),
    ]);
  });
});
