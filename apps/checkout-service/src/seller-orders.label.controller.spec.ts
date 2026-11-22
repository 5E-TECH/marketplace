import { NotFoundException } from '@nestjs/common';
import { SellerOrdersController } from './seller-orders.controller';
import { SellerOrdersService } from './seller-orders.service';
import { ShippingLabelService } from './shipping-label.service';

describe('SellerOrdersController label RPC (C1.45)', () => {
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
      { generateBatch } as unknown as ShippingLabelService,
      { isLeadOrder: jest.fn(async () => false) } as never,
      {
        leadOrderIds: jest.fn(async () => []),
        collectLabels: jest.fn(async () => ({ labels: [], skipped: [] })),
      } as never,
    );
    return { controller, generateBatch };
  }

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
