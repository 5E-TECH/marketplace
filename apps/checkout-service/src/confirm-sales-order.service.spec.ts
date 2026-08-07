import { of, throwError } from 'rxjs';
import { ConfirmSalesOrderService } from './confirm-sales-order.service';

describe('ConfirmSalesOrderService (C2.10)', () => {
  function setup(failingShipment = false) {
    const sellers = [
      { id: '11', shop_id: '101', subtotal: '200', elchi_shipment_id: null },
      { id: '12', shop_id: '102', subtotal: '300', elchi_shipment_id: null },
    ];
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('FROM checkout.sales_order WHERE')) {
          return [
            {
              id: '1',
              customer_id: '5',
              buyer_name: 'Ali',
              status: 'draft',
              payment_method: 'cod',
              total_amount: '500',
              delivery_address: 'Toshkent\n+998901234567',
              region_id: '1',
              district_id: '2',
              where_deliver: 'ADDRESS',
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
        if (failingShipment && shipmentCall === 2) {
          return throwError(() => new Error('Elchi unavailable'));
        }
        return of({
          shipment_id: `shipment-${shipmentCall}`,
          tracking_url: `https://track/${shipmentCall}`,
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
      queries.filter((entry) =>
        entry.sql.includes('UPDATE checkout.sales_order_seller'),
      ),
    ).toHaveLength(2);
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
          entry.sql.includes("status='confirmed'"),
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
    const { service, inventory, notifications, queries, dataSource } =
      setup(true);
    await expect(service.confirm('1', '5')).rejects.toThrow(
      'Elchi unavailable',
    );
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(inventory.send).not.toHaveBeenCalled();
    expect(notifications.emit).not.toHaveBeenCalled();
    expect(
      queries.some(
        (entry) =>
          entry.sql.includes('UPDATE checkout.sales_order\n         SET') &&
          entry.sql.includes("status='confirmed'"),
      ),
    ).toBe(false);
  });
});
