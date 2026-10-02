import { NotificationEventsController } from './notification-events.controller';
import { NotificationService } from './notification.service';
import { NotificationTemplateService } from './notification-template.service';

describe('NotificationEventsController', () => {
  const create = jest.fn();
  /** Bazadagi tahrirlangan shablonlar (C6.8); bo'sh — standart matnlar. */
  const overrides = new Map<string, { title: string; body: string }>();
  const templates = new NotificationTemplateService({
    findOneBy: jest.fn(
      async ({ key }: { key: string }) => overrides.get(key) ?? null,
    ),
  } as never);
  const controller = new NotificationEventsController(
    { create } as unknown as NotificationService,
    templates,
  );

  beforeEach(() => {
    create.mockReset().mockResolvedValue({ id: '1' });
    overrides.clear();
  });

  /**
   * C6.8 regressiya: matnlar kodda qattiq yozilgan joydan shablonlarga
   * ko'chirildi — standart holatda xabar AYNAN avvalgidek bo'lishi shart.
   */
  it('C6.8: standart shablonlar avvalgi matnlarni harfma-harf beradi', async () => {
    await controller.sellerRegistered({
      sellerUserId: '10',
      shopId: '20',
      sellerName: 'Ali',
      shopName: 'Ali Shop',
    });
    await controller.shopApproved({
      sellerUserId: '10',
      shopId: '20',
      shopName: 'Ali Shop',
    });
    await controller.shopRejected({
      sellerUserId: '10',
      shopId: '20',
      shopName: 'Ali Shop',
      reason: 'Hujjat yo‘q',
    });
    await controller.shopRejected({
      sellerUserId: '10',
      shopId: '20',
      shopName: 'Ali Shop',
      reason: null,
    });
    await controller.orderCreated({
      orderId: '50',
      orderNumber: 'A-50',
      recipients: [{ userId: '10' }],
    });
    await controller.orderCancelled({
      orderId: '50',
      reason: 'Tovar yo‘q',
      recipients: [{ userId: '10' }],
    });

    expect(
      create.mock.calls.map(([input]) => [input.title, input.body]),
    ).toEqual([
      [
        'Arizangiz qabul qilindi',
        'Ali Shop do‘koni ro‘yxatdan o‘tdi va tasdiqlash uchun yuborildi.',
      ],
      ['Do‘kon tasdiqlandi', 'Ali Shop do‘koningiz faol holatga o‘tdi.'],
      [
        'Do‘kon rad etildi',
        'Ali Shop do‘koningiz rad etildi. Sabab: Hujjat yo‘q',
      ],
      ['Do‘kon rad etildi', 'Ali Shop do‘koningiz rad etildi.'],
      ['Yangi buyurtma', 'A-50 raqamli buyurtma yaratildi.'],
      ['Buyurtma bekor qilindi', '#50 buyurtma. Sabab: Tovar yo‘q'],
    ]);
  });

  it('C6.8 TC2: tahrirlangan shablon keyingi xabardayoq ishlatiladi', async () => {
    overrides.set('shop_approved', {
      title: 'Tabriklaymiz!',
      body: '{shopName} endi sotuvda. Omad!',
    });

    await controller.shopApproved({
      sellerUserId: '10',
      shopId: '20',
      shopName: 'Ali Shop',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'shop_approved',
        title: 'Tabriklaymiz!',
        body: 'Ali Shop endi sotuvda. Omad!',
      }),
    );
  });

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
