import { NotificationEventsController } from './notification-events.controller';
import { NotificationService } from './notification.service';

describe('NotificationEventsController', () => {
  const create = jest.fn();
  const controller = new NotificationEventsController({
    create,
  } as unknown as NotificationService);

  beforeEach(() => create.mockReset().mockResolvedValue({ id: '1' }));

  it('registration eventidan in-app notification yaratadi', async () => {
    await controller.sellerRegistered({
      sellerUserId: '10',
      shopId: '20',
      sellerName: 'Ali',
      shopName: 'Ali Shop',
      phone: '+998901234567',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: expect.objectContaining({ userId: '10' }),
        type: 'register',
        data: { shopId: '20' },
      }),
    );
  });

  it('approve eventidan seller notification yaratadi', async () => {
    await controller.shopApproved({
      sellerUserId: '10',
      shopId: '20',
      shopName: 'Ali Shop',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'shop_approved' }),
    );
  });

  it('C6.6 TC4: yashirilgan mahsulot sababini sellerga yuboradi', async () => {
    await controller.productHidden({
      sellerUserId: '10',
      productId: '30',
      productName: 'Telefon',
      shopId: '20',
      reason: 'Rasm qoidalarga zid',
    });
    expect(create).toHaveBeenCalledWith({
      recipient: { userId: '10' },
      type: 'product_hidden',
      title: 'Mahsulot yashirildi',
      body: expect.stringContaining('Rasm qoidalarga zid'),
      data: {
        productId: '30',
        shopId: '20',
        reason: 'Rasm qoidalarga zid',
      },
    });
  });

  it('order eventidagi har recipient uchun notification yaratadi', async () => {
    await controller.orderCreated({
      orderId: '50',
      recipients: [{ userId: '10' }, { userId: '11' }],
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('C6.4 refund buyer va sellerga notification yaratadi', async () => {
    await controller.orderRefunded({
      orderId: '50',
      reason: 'Tovar mavjud emas',
      recipients: [{ userId: '10' }, { userId: '11' }],
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'order_refunded',
        data: { orderId: '50', reason: 'Tovar mavjud emas' },
      }),
    );
  });

  it('C4.2 qaytarish holati: rad etish sababi va refund summasi matnda', async () => {
    await controller.returnStatusChanged({
      returnId: '3',
      orderId: '50',
      status: 'REJECTED',
      comment: 'Tovar ishlatilgan',
      recipients: [{ userId: '10' }],
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'return_rejected',
        title: 'Qaytarish so‘rovi rad etildi',
        body: expect.stringContaining('Sabab: Tovar ishlatilgan'),
        data: { returnId: '3', orderId: '50', status: 'REJECTED' },
      }),
    );

    await controller.returnStatusChanged({
      returnId: '3',
      orderId: '50',
      status: 'REFUNDED',
      amount: 150000,
      recipients: [{ userId: '10' }, { userId: '11' }],
    });
    expect(create).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'return_refunded',
        body: expect.stringContaining('150'),
      }),
    );
  });
});
