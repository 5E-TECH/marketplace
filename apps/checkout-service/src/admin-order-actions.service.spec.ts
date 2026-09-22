import { of } from 'rxjs';
import { SellerOrdersService } from './seller-orders.service';

describe('C6.4 admin order actions', () => {
  function setup(options: { status?: string; paymentMethod?: string } = {}) {
    const queries: string[] = [];
    const manager = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM checkout.sales_order WHERE')) {
          return [
            {
              id: '10',
              status: options.status ?? 'CONFIRMED',
              payment_method: options.paymentMethod ?? 'online',
              payment_id: '90',
              total_amount: 120000,
              customer_id: '5',
            },
          ];
        }
        if (sql.includes('FROM checkout.sales_order_seller WHERE')) {
          return [
            { id: '21', shop_id: '7' },
            { id: '22', shop_id: '8' },
          ];
        }
        if (sql.includes('FROM checkout.sales_order_item')) {
          return [{ variantId: '3', quantity: 2 }];
        }
        return [];
      }),
    };
    const dataSource = { transaction: jest.fn((run) => run(manager)) };
    const inventory = { send: jest.fn(() => of({ operation: 'INBOUND' })) };
    const payment = {
      send: jest.fn(() => of({ status: 'REFUNDED', idempotent: false })),
    };
    const finance = { send: jest.fn(() => of({ idempotent: false })) };
    const notifications = { emit: jest.fn(() => of(undefined)) };
    const catalog = {
      send: jest.fn((_pattern, payload) =>
        of({ ownerUserId: payload.shopId === '7' ? '70' : '80' }),
      ),
    };
    const service = new SellerOrdersService(
      dataSource as never,
      undefined,
      undefined,
      inventory as never,
      payment as never,
      finance as never,
      notifications as never,
      catalog as never,
    );
    return {
      service,
      inventory,
      payment,
      finance,
      notifications,
      catalog,
      queries,
    };
  }

  it('TC1/TC3/TC5: paid refund payment, stock va har seller ledgerini qaytaradi', async () => {
    const { service, inventory, payment, finance, notifications, queries } =
      setup();
    await expect(
      service.adminRefundOrder({
        orderId: '10',
        reason: 'Tovar yo‘q',
        actorId: '1',
      }),
    ).resolves.toMatchObject({
      id: '10',
      status: 'REFUNDED',
      idempotent: false,
    });
    expect(payment.send).toHaveBeenCalledTimes(1);
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: 'inventory.return-order-items' },
      expect.objectContaining({
        orderRef: '10',
        items: [{ variantId: '3', quantity: 2 }],
      }),
    );
    expect(finance.send).toHaveBeenCalledTimes(2);
    expect(notifications.emit).toHaveBeenCalledWith(
      'order.refunded',
      expect.objectContaining({
        recipients: [{ userId: '5' }, { userId: '70' }, { userId: '80' }],
      }),
    );
    expect(queries.some((sql) => sql.includes("status='REFUNDED'"))).toBe(true);
  });

  it('TC2: REFUNDED order takror chaqirilsa side effect qaytarmaydi', async () => {
    const { service, inventory, payment, finance } = setup({
      status: 'REFUNDED',
    });
    await expect(
      service.adminRefundOrder({
        orderId: '10',
        reason: 'retry',
        actorId: '1',
      }),
    ).resolves.toMatchObject({ idempotent: true });
    expect(payment.send).not.toHaveBeenCalled();
    expect(inventory.send).not.toHaveBeenCalled();
    expect(finance.send).not.toHaveBeenCalled();
  });

  it('TC4: COD order refund qilinmaydi', async () => {
    const { service, payment } = setup({ paymentMethod: 'cod' });
    await expect(
      service.adminRefundOrder({ orderId: '10', reason: 'x', actorId: '1' }),
    ).rejects.toThrow('COD');
    expect(payment.send).not.toHaveBeenCalled();
  });

  it('admin cancel HELD rezervatsiyani release qiladi', async () => {
    const { service, inventory, queries } = setup({
      status: 'PENDING_PAYMENT',
    });
    await expect(
      service.adminCancelOrder({
        orderId: '10',
        reason: 'Admin cancel',
        actorId: '1',
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED', idempotent: false });
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: 'inventory.release' },
      expect.objectContaining({
        orderRef: '10',
        idempotencyKey: 'admin-cancel:10',
      }),
    );
    expect(queries.some((sql) => sql.includes("status='CANCELLED'"))).toBe(
      true,
    );
  });

  it('bekor qilishda yakunlanmagan online to‘lov ham yopiladi', async () => {
    const { service, payment } = setup({ status: 'PENDING_PAYMENT' });
    await service.adminCancelOrder({
      orderId: '10',
      reason: 'Admin cancel',
      actorId: '1',
    });
    expect(payment.send).toHaveBeenCalledWith(
      { cmd: 'payment.cancel-open' },
      expect.objectContaining({ salesOrderId: '10' }),
    );
  });

  it('COD buyurtmani bekor qilishda payment-service bezovta qilinmaydi', async () => {
    const { service, payment } = setup({
      status: 'PENDING_PAYMENT',
      paymentMethod: 'cod',
    });
    await service.adminCancelOrder({
      orderId: '10',
      reason: 'Admin cancel',
      actorId: '1',
    });
    expect(payment.send).not.toHaveBeenCalled();
  });

  it('partial refundni providerga yubormasdan rad etadi', async () => {
    const { service, payment } = setup();
    await expect(
      service.adminRefundOrder({
        orderId: '10',
        reason: 'x',
        amount: 100,
        actorId: '1',
      }),
    ).rejects.toThrow('to‘liq refund');
    expect(payment.send).not.toHaveBeenCalled();
  });
});

describe('xaridor buyurtmani qaytaradi', () => {
  function setup(
    options: {
      status?: string;
      paymentMethod?: string;
      sellerStatuses?: string[];
    } = {},
  ) {
    const status = options.status ?? 'CONFIRMED';
    const paymentMethod = options.paymentMethod ?? 'online';
    const shippedCount = (
      options.sellerStatuses ?? ['SHIPMENT_CREATED']
    ).filter(
      (value) => !['PENDING', 'CONFIRMED', 'SHIPMENT_CREATED'].includes(value),
    ).length;
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM checkout.sales_order WHERE'))
          return [
            {
              id: '10',
              status,
              payment_method: paymentMethod,
              payment_id: '90',
              total_amount: 120000,
              customer_id: '5',
            },
          ];
        if (sql.includes('FROM checkout.sales_order_seller WHERE'))
          return [{ id: '21', shop_id: '7' }];
        if (sql.includes('FROM checkout.sales_order_item'))
          return [{ variantId: '3', quantity: 2 }];
        return [];
      }),
    };
    const dataSource = {
      transaction: jest.fn((run) => run(manager)),
      query: jest.fn(async (sql: string) => {
        if (sql.includes('session_id AS "sessionId"'))
          return [{ customerId: '5', sessionId: null }];
        if (sql.includes('payment_method AS "paymentMethod"'))
          return [{ status, paymentMethod }];
        if (sql.includes('COUNT(*)::int AS total'))
          return [{ total: shippedCount }];
        return [];
      }),
    };
    const inventory = { send: jest.fn(() => of({ operation: 'INBOUND' })) };
    const payment = { send: jest.fn(() => of({ status: 'REFUNDED' })) };
    const finance = { send: jest.fn(() => of({ idempotent: false })) };
    const notifications = { emit: jest.fn(() => of(undefined)) };
    const catalog = { send: jest.fn(() => of({ ownerUserId: '70' })) };
    return {
      service: new SellerOrdersService(
        dataSource as never,
        undefined,
        undefined,
        inventory as never,
        payment as never,
        finance as never,
        notifications as never,
        catalog as never,
      ),
      inventory,
      payment,
      finance,
    };
  }

  const refund = (service: SellerOrdersService) =>
    service.buyerRefundOrder({
      orderId: '10',
      reason: 'Fikrimdan qaytdim',
      customerId: '5',
    });

  it('to‘lanmagan buyurtmani bekor qiladi va rezervni bo‘shatadi', async () => {
    const { service, inventory, payment, finance } = setup({
      status: 'PENDING_PAYMENT',
    });
    await expect(refund(service)).resolves.toMatchObject({
      status: 'CANCELLED',
      idempotent: false,
    });
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: 'inventory.release' },
      expect.objectContaining({ orderRef: '10' }),
    );
    expect(payment.send).toHaveBeenCalledWith(
      { cmd: 'payment.cancel-open' },
      expect.objectContaining({ salesOrderId: '10' }),
    );
    expect(finance.send).not.toHaveBeenCalled();
  });

  it('posilka chiqmagan to‘langan buyurtmani to‘liq refund qiladi', async () => {
    const { service, payment, finance } = setup();
    await expect(refund(service)).resolves.toMatchObject({
      status: 'REFUNDED',
      idempotent: false,
    });
    expect(payment.send).toHaveBeenCalledWith(
      { cmd: 'payment.refund' },
      expect.objectContaining({ salesOrderId: '10' }),
    );
    expect(finance.send).toHaveBeenCalledTimes(1);
  });

  it('yo‘lga chiqqan posilkani xaridor o‘zi qaytara olmaydi', async () => {
    const { service, payment } = setup({ sellerStatuses: ['ON_THE_ROAD'] });
    await expect(refund(service)).rejects.toThrow('qo‘llab-quvvatlash');
    expect(payment.send).not.toHaveBeenCalled();
  });

  it('COD buyurtma uchun tushunarli xabar beradi', async () => {
    const { service, payment } = setup({ paymentMethod: 'cod' });
    await expect(refund(service)).rejects.toThrow('kuryerga');
    expect(payment.send).not.toHaveBeenCalled();
  });

  it('allaqachon qaytarilgan buyurtma idempotent javob beradi', async () => {
    const { service, payment, inventory } = setup({ status: 'REFUNDED' });
    await expect(refund(service)).resolves.toMatchObject({
      status: 'REFUNDED',
      idempotent: true,
    });
    expect(payment.send).not.toHaveBeenCalled();
    expect(inventory.send).not.toHaveBeenCalled();
  });

  it('begona xaridorga ruxsat bermaydi', async () => {
    const { service } = setup();
    await expect(
      service.buyerRefundOrder({
        orderId: '10',
        reason: 'x',
        customerId: '99',
      }),
    ).rejects.toThrow('ruxsat yo‘q');
  });
});
