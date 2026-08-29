import { of } from 'rxjs';
import { ConfirmSalesOrderService } from './confirm-sales-order.service';

describe('payment.paid → confirmSalesOrder (C3.4)', () => {
  function setup() {
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
              status: 'PENDING_PAYMENT',
              payment_method: 'online',
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
    const integration = {
      send: jest.fn((_pattern, data: { external_order_id: string }) =>
        of({ shipment_id: `shipment-${data.external_order_id}` }),
      ),
    };
    const notifications = { emit: jest.fn(() => of(undefined)) };
    return {
      service: new ConfirmSalesOrderService(
        dataSource as never,
        inventory as never,
        integration as never,
        catalog as never,
        notifications as never,
      ),
      inventory,
      integration,
      queries,
    };
  }

  it('TC1: paid event online orderni tasdiqlab prepaid shipment ochadi', async () => {
    const { service, integration, queries } = setup();

    await expect(service.confirmPaid('1', '90', 500)).resolves.toMatchObject({
      id: '1',
      status: 'CONFIRMED',
      sellerOrders: [{ id: '11' }, { id: '12' }],
    });
    expect(integration.send).toHaveBeenCalledTimes(2);
    for (const call of integration.send.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ cod_amount: 0 }));
    }
    expect(
      queries.some(
        ({ sql, params }) =>
          sql.includes("status='CONFIRMED'") &&
          sql.includes('payment_id=COALESCE') &&
          params[1] === '90',
      ),
    ).toBe(true);
  });

  it('TC3: confirm inventory.commit orqali rezervni qoldiqdan yechadi', async () => {
    const { service, inventory } = setup();

    await service.confirmPaid('1', '90', 500);
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: 'inventory.commit' },
      expect.objectContaining({
        orderRef: '1',
        idempotencyKey: 'confirm:1',
      }),
    );
  });

  it('summa buyurtmaga mos bo‘lmasa confirm va commit qilmaydi', async () => {
    const { service, inventory, integration } = setup();

    await expect(service.confirmPaid('1', '90', 499)).rejects.toThrow(
      'To‘lov summasi buyurtmaga mos emas',
    );
    expect(integration.send).not.toHaveBeenCalled();
    expect(inventory.send).not.toHaveBeenCalled();
  });
});
