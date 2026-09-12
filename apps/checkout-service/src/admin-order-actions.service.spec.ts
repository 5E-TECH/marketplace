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
