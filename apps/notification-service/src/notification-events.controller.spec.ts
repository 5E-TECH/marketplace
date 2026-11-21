import { of } from 'rxjs';
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
  const identitySend = jest.fn();
  const controller = new NotificationEventsController(
    { create } as unknown as NotificationService,
    templates,
    { send: identitySend } as never,
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

  it('BE-09: to‘q sariq narx — har bir faol superadminga xabar; superadmin yo‘q bo‘lsa — hech narsa', async () => {
    identitySend.mockReturnValueOnce(
      of([
        { id: '1', phone: '+998900000001', email: null },
        { id: '2', phone: '+998900000002', email: 'a@x.uz' },
      ]),
    );
    await controller.priceOrange({
      productId: '10',
      productName: 'Simsiz quloqchin',
      price: 245000,
      recommended: 262000,
      reason: 'Raqobatchi narxi past',
      decidedBy: '7',
    });
    expect(identitySend).toHaveBeenCalledWith(
      { cmd: 'identity.user.active-by-role' },
      { role: 'SUPERADMIN' },
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: { userId: '2', email: 'a@x.uz', phone: '+998900000002' },
        type: 'price_orange',
        title: 'To‘q sariq narx tasdiqlandi',
        body: 'Simsiz quloqchin: 245000 so‘m (tavsiya 262000). Sabab: Raqobatchi narxi past',
        data: { productId: '10', decidedBy: '7' },
      }),
    );
    create.mockClear();
    identitySend.mockReturnValueOnce(of([]));
    await controller.priceOrange({
      productId: '10',
      productName: 'X',
      price: 1,
      recommended: 2,
      reason: null,
      decidedBy: '7',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('BE-21: sverka farqi — moliya va nazoratchiga (ikki rolda bitta odam — bitta xabar)', async () => {
    identitySend
      .mockReturnValueOnce(
        of([
          { id: '5', phone: '+998900000005', email: null },
          { id: '6', phone: '+998900000006', email: 'f@x.uz' },
        ]),
      )
      .mockReturnValueOnce(
        of([{ id: '6', phone: '+998900000006', email: 'f@x.uz' }]),
      );
    await controller.codMismatch({
      date: '2026-12-01',
      mismatchCount: 2,
      diffTotal: -21000,
      orders: [
        { orderId: '509', expected: 251000, received: 240000, diff: -11000 },
      ],
    });
    expect(identitySend).toHaveBeenCalledWith(
      { cmd: 'identity.user.active-by-role' },
      { role: 'FINANCE' },
    );
    expect(identitySend).toHaveBeenCalledWith(
      { cmd: 'identity.user.active-by-role' },
      { role: 'SUPERVISOR' },
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cod_reconciliation_mismatch',
        title: 'Sverka farqi: 2026-12-01',
        body: '2026-12-01: Elchi o‘tkazmasi 2 ta buyurtmada mos emas, farq -21000 so‘m. Moliya → kunlik sverka.',
      }),
    );
  });

  it('BE-21: Elchi sotuvni bekor qildi — moliya va nazoratchiga', async () => {
    identitySend
      .mockReturnValueOnce(
        of([{ id: '5', phone: '+998900000005', email: null }]),
      )
      .mockReturnValueOnce(of([]));
    await controller.elchiSaleRollback({
      orderId: '77',
      shipmentId: '1251177',
      orderStatus: 'DELIVERED',
      elchiStatus: 'cancelled',
      eventId: 'evt-1',
      occurredAt: '2026-12-01T10:00:00.000Z',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'elchi_sale_rollback',
        title: 'Elchi sotuvni bekor qildi: buyurtma 77',
      }),
    );
  });
});
