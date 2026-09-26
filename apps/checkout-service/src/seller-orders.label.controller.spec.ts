import { ConflictException, NotFoundException } from '@nestjs/common';
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
      senderName: 'Nodira Butik',
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

  function batchController(
    orders: Partial<Record<keyof SellerOrdersService, jest.Mock>>,
  ) {
    const generateBatch = jest
      .fn()
      .mockImplementation(async (labels: unknown[], skipped: unknown[]) => ({
        fileName: `shipments-${labels.length}.pdf`,
        contentType: 'application/pdf',
        base64: 'JVBERg==',
        ...(skipped.length ? { skipped } : {}),
      }));
    const controller = new SellerOrdersController(
      orders as unknown as SellerOrdersService,
      { send: jest.fn(() => of({ id: '4' })) } as never,
      { send: jest.fn() } as never,
      { generateBatch } as unknown as ShippingLabelService,
    );
    return { controller, generateBatch };
  }

  it('TC5: bir nechta orderni do‘kon scope bilan bitta batch PDF ga uzatadi', async () => {
    const collectShippingLabels = jest.fn().mockResolvedValue({
      labels: [{ sellerOrderId: '9' }, { sellerOrderId: '10' }],
      skipped: [],
    });
    const { controller, generateBatch } = batchController({
      collectShippingLabels,
    });

    await controller.labelsBatch({ ownerUserId: '42', orderIds: ['9', '10'] });

    expect(collectShippingLabels).toHaveBeenCalledWith([
      { shopId: '4', sellerOrderId: '9', orderId: '9' },
      { shopId: '4', sellerOrderId: '10', orderId: '10' },
    ]);
    expect(generateBatch).toHaveBeenCalledWith(
      [
        expect.objectContaining({ sellerOrderId: '9' }),
        expect.objectContaining({ sellerOrderId: '10' }),
      ],
      [],
    );
  });

  it('qisman: chiqqanlari PDF, chiqmaganlari skipped da', async () => {
    const skipped = [{ orderId: '7', reason: 'QR tokeni mavjud emas' }];
    const { controller } = batchController({
      collectShippingLabels: jest.fn().mockResolvedValue({
        labels: [{ sellerOrderId: '9' }],
        skipped,
      }),
    });

    await expect(
      controller.labelsBatch({ shopId: '4', orderIds: ['9', '7'] }),
    ).resolves.toMatchObject({ fileName: 'shipments-1.pdf', skipped });
  });

  it('birortasi ham chiqmasa 409 — har biri sababi bilan', async () => {
    const { controller, generateBatch } = batchController({
      collectShippingLabels: jest.fn().mockResolvedValue({
        labels: [],
        skipped: [
          {
            orderId: '6',
            reason: 'Yorliq uchun avval Elchi shipment yaratish kerak',
          },
          { orderId: '7', reason: 'Elchi shipment QR tokeni mavjud emas' },
          { orderId: '8', reason: 'Elchi shipment QR tokeni mavjud emas' },
          // admin: bitta buyurtmaning ikki posilkasi — id takrorlanmaydi
          {
            orderId: '8',
            sellerOrderId: '15',
            reason: 'Elchi shipment QR tokeni mavjud emas',
          },
        ],
      }),
    });

    const error = await controller
      .labelsBatch({ shopId: '4', orderIds: ['6', '7', '8'] })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(
      'Yorliq chiqmadi — Yorliq uchun avval Elchi shipment yaratish kerak: #6; ' +
        'Elchi shipment QR tokeni mavjud emas: #7, #8',
    );
    expect(generateBatch).not.toHaveBeenCalled();
  });

  it('admin: sales_order id → barcha posilkalar; topilmaganlar skipped ga qo‘shiladi', async () => {
    const targets = [
      { sellerOrderId: '14', orderId: '14', shopId: '5' },
      { sellerOrderId: '15', orderId: '14', shopId: '7' },
    ];
    const missing = [{ orderId: '99', reason: 'Buyurtma topilmadi' }];
    const adminShippingLabelTargets = jest
      .fn()
      .mockResolvedValue({ targets, missing });
    const collectShippingLabels = jest.fn().mockResolvedValue({
      labels: [{ sellerOrderId: '14' }, { sellerOrderId: '15' }],
      skipped: [],
    });
    const { controller, generateBatch } = batchController({
      adminShippingLabelTargets,
      collectShippingLabels,
    });

    await controller.adminLabelsBatch({ orderIds: ['14', '99'] });

    expect(collectShippingLabels).toHaveBeenCalledWith(targets);
    expect(generateBatch).toHaveBeenCalledWith(expect.any(Array), missing);
  });

  it('admin bitta buyurtma topilmasa 404', async () => {
    const { controller } = batchController({
      adminShippingLabelTargets: jest.fn().mockResolvedValue({
        targets: [],
        missing: [{ orderId: '99', reason: 'Buyurtma topilmadi' }],
      }),
    });

    await expect(
      controller.adminLabel({ orderId: '99' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
