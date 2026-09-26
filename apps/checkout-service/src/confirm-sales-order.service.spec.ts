import { of, throwError } from 'rxjs';
import { ConfirmSalesOrderService } from './confirm-sales-order.service';

describe('ConfirmSalesOrderService (C2.10)', () => {
  function setup(
    options: {
      failingShipment?: boolean;
      orderMissing?: boolean;
      order?: Record<string, unknown>;
    } = {},
  ) {
    const sellers = [
      { id: '11', shop_id: '101', subtotal: '200', elchi_shipment_id: null },
      { id: '12', shop_id: '102', subtotal: '300', elchi_shipment_id: null },
    ];
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('FROM checkout.sales_order WHERE')) {
          if (options.orderMissing) return [];
          return [
            {
              id: '1',
              customer_id: '5',
              session_id: 'guest-session',
              buyer_name: 'Ali',
              status: 'DRAFT',
              payment_method: 'cod',
              total_amount: '500',
              delivery_address: 'Toshkent\n+998901234567',
              region_id: '1',
              district_id: '2',
              where_deliver: 'ADDRESS',
              ...options.order,
            },
          ];
        }
        if (sql.includes('FROM checkout.sales_order_seller')) return sellers;
        if (sql.includes('FROM checkout.sales_order_item')) {
          return [{ product_id: '77', product_name: 'Telefon', quantity: 1 }];
        }
        return [];
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (run) => run(manager)),
    };
    const inventory = { send: jest.fn(() => of({ operation: 'commit' })) };
    const catalog = {
      send: jest.fn((_pattern, data: { shopId: string }) =>
        of({
          ownerUserId: `owner-${data.shopId}`,
          elchiMarketId: `market-${data.shopId}`,
        }),
      ),
    };
    let shipmentCall = 0;
    const integration = {
      send: jest.fn(() => {
        shipmentCall++;
        if (options.failingShipment && shipmentCall === 2) {
          return throwError(() => new Error('Elchi unavailable'));
        }
        return of({
          shipment_id: `shipment-${shipmentCall}`,
          tracking_url: `https://track/${shipmentCall}`,
          qr_code_token: `3e3a70f78d54064348bde4${shipmentCall}0`,
          to_be_paid: shipmentCall === 1 ? 200 : 300,
        });
      }),
    };
    const notifications = { emit: jest.fn(() => of(undefined)) };
    const service = new ConfirmSalesOrderService(
      dataSource as never,
      inventory as never,
      integration as never,
      catalog as never,
      notifications as never,
    );
    return {
      service,
      queries,
      inventory,
      integration,
      notifications,
      dataSource,
    };
  }

  it('TC1/TC3: har sellerga COD shipment ochib id sini saqlaydi', async () => {
    const { service, integration, queries } = setup();
    const result = await service.confirm('1', '5');

    expect(result.sellerOrders).toHaveLength(2);
    expect(integration.send).toHaveBeenCalledTimes(2);
    expect(integration.send).toHaveBeenNthCalledWith(
      1,
      { cmd: 'integration.shipment.create' },
      expect.objectContaining({
        external_order_id: '11',
        cod_amount: 200,
        elchi_market_id: 'market-101',
      }),
    );
    expect(
      queries.filter(
        (entry) =>
          entry.sql.includes('UPDATE checkout.sales_order_seller') &&
          entry.sql.includes("status='SHIPMENT_CREATED'"),
      ),
    ).toHaveLength(2);
  });

  /**
   * C1.45 BLOKER regressiyasi: posilkalarning asosiy qismi shu oqimda
   * yaratiladi, lekin avval UPDATE `qr_code_token` ni tashlab yuborardi —
   * prodda 7/8/11/14/15-satrlar tokensiz qolib, yorliq 409 berardi.
   */
  it('C1.45 TC1: Elchi qaytargan qr_code_token va to_be_paid saqlanadi, tarixga yoziladi', async () => {
    const { service, queries } = setup();
    await service.confirm('1', '5');

    const updates = queries.filter(
      (entry) =>
        entry.sql.includes('UPDATE checkout.sales_order_seller') &&
        entry.sql.includes('qr_code_token=$3'),
    );
    expect(updates).toHaveLength(2);
    expect(updates[0].sql).toContain('elchi_to_be_paid=$4');
    expect(updates[0].params).toEqual([
      'shipment-1',
      'https://track/1',
      '3e3a70f78d54064348bde410',
      200,
      '11',
    ]);
    expect(updates[1].params).toEqual(
      expect.arrayContaining(['3e3a70f78d54064348bde420', 300, '12']),
    );
    const history = queries.filter((entry) =>
      entry.sql.includes('INSERT INTO checkout.sales_order_seller_history'),
    );
    expect(history.map((entry) => entry.params)).toEqual([['11'], ['12']]);
  });

  it('TC2: shipmentlardan keyin inventory commit va confirmed qiladi', async () => {
    const { service, inventory, queries } = setup();
    await service.confirm('1', '5');

    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: 'inventory.commit' },
      expect.objectContaining({
        orderRef: '1',
        idempotencyKey: 'confirm:1',
      }),
    );
    expect(
      queries.some(
        (entry) =>
          entry.sql.includes('UPDATE checkout.sales_order\n         SET') &&
          entry.sql.includes("status='CONFIRMED'"),
      ),
    ).toBe(true);
  });

  it('TC3: buyer va sellerlarga notification yuboradi', async () => {
    const { service, notifications } = setup();
    await service.confirm('1', '5');
    expect(notifications.emit).toHaveBeenCalledWith(
      'order.created',
      expect.objectContaining({
        orderId: '1',
        recipients: [
          { userId: '5' },
          { userId: 'owner-101' },
          { userId: 'owner-102' },
        ],
      }),
    );
  });

  it('TC4: shipment xatosida inventory commit va order confirm bo‘lmaydi', async () => {
    const { service, inventory, notifications, queries, dataSource } = setup({
      failingShipment: true,
    });
    // Elchi'ning xom xatosi mijozga ketmaydi — faqat umumiy xabar (sendRpc).
    await expect(service.confirm('1', '5')).rejects.toThrow(
      'Birozdan so‘ng qayta urinib ko‘ring',
    );
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(inventory.send).not.toHaveBeenCalled();
    expect(notifications.emit).not.toHaveBeenCalled();
    expect(
      queries.some(
        (entry) =>
          entry.sql.includes('UPDATE checkout.sales_order\n         SET') &&
          entry.sql.includes("status='CONFIRMED'"),
      ),
    ).toBe(false);
  });

  it('guest o‘z sessioni bilan COD orderni confirm qiladi', async () => {
    const { service } = setup();

    await expect(
      service.confirm('1', undefined, 'guest-session'),
    ).resolves.toMatchObject({ id: '1', status: 'CONFIRMED' });
  });

  it.each([
    ['begona buyer', '99', undefined],
    ['begona guest session', undefined, 'other-session'],
  ])('%s confirm qilsa 403 qaytaradi', async (_name, buyerId, sessionId) => {
    const { service, integration } = setup();

    await expect(service.confirm('1', buyerId, sessionId)).rejects.toThrow(
      'ruxsat yo‘q',
    );
    expect(integration.send).not.toHaveBeenCalled();
  });

  it('mavjud bo‘lmagan order uchun 404 qaytaradi', async () => {
    const { service } = setup({ orderMissing: true });

    await expect(service.confirm('999', '5')).rejects.toThrow(
      'Buyurtma topilmadi',
    );
  });
});
